import io
import json
import re
import sqlite3
import tempfile
import uuid
import zipfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone as dt_timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from core.models import ChecklistItem, LogEntry, Profile, StreakBonusRule, Tag, Task


TASKAPP_LOG_TYPE_MAP = {
    0: LogEntry.LogType.DAILY_COMPLETED,
    1: LogEntry.LogType.HABIT_INCREMENTED,
    2: LogEntry.LogType.TODO_COMPLETED,
    3: LogEntry.LogType.REWARD_CLAIMED,
    4: LogEntry.LogType.ACTIVITY_DURATION,
}

TASKAPP_LOG_TYPE_REVERSE_MAP = {value: key for key, value in TASKAPP_LOG_TYPE_MAP.items()}
CENT = Decimal("0.01")


def _ensure_owner(profile: Profile, user) -> None:
    if profile.account_id != user.id:
        raise ValidationError({"profile": "Profile does not belong to the authenticated user."})


def _iso_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    if timezone.is_naive(value):
        value = timezone.make_aware(value, timezone.get_current_timezone())
    return value.astimezone(dt_timezone.utc).isoformat().replace("+00:00", "Z")


def _iso_datetime_in_zone(value: datetime | None, *, target_tz: ZoneInfo | None) -> str | None:
    if value is None:
        return None
    if timezone.is_naive(value):
        value = timezone.make_aware(value, timezone.get_current_timezone())
    if target_tz is not None:
        return value.astimezone(target_tz).isoformat()
    return value.astimezone(dt_timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_datetime(
    value: str | None,
    *,
    interpret_as_wall_time_tz: ZoneInfo | None = None,
) -> datetime | None:
    if not value:
        return None
    # TaskApp stores up to 7 fractional second digits; Python expects <= 6.
    cleaned = re.sub(r"\.(\d{6})\d+(?=(Z|[+-]\d{2}:\d{2})$)", r".\1", value)

    try:
        parsed = datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
    except ValueError:
        return None

    suffix_match = re.search(r"(Z|[+-]\d{2}:\d{2})$", cleaned)
    suffix = suffix_match.group(1) if suffix_match else None

    # Some TaskApp exports carry a fixed offset that drifts around DST boundaries.
    # For due dates with non-UTC offsets, prefer the importing browser's timezone wall-time.
    # Keep true UTC instants ("Z"/"+00:00") unchanged so taskweb export/import round-trips exactly.
    if (
        interpret_as_wall_time_tz is not None
        and suffix is not None
        and suffix not in {"Z", "+00:00", "-00:00"}
    ):
        wall_source = re.sub(r"(Z|[+-]\d{2}:\d{2})$", "", cleaned)
        try:
            wall = datetime.fromisoformat(wall_source)
            if timezone.is_naive(wall):
                wall = wall.replace(tzinfo=interpret_as_wall_time_tz)
            return wall.astimezone(dt_timezone.utc)
        except ValueError:
            pass

    if timezone.is_naive(parsed):
        if interpret_as_wall_time_tz is not None:
            parsed = parsed.replace(tzinfo=interpret_as_wall_time_tz)
        else:
            parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _to_decimal(value, *, default: str = "0") -> Decimal:
    try:
        if value is None:
            return Decimal(default)
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal(default)


def _to_cents(value, *, default: str = "0") -> Decimal:
    return _to_decimal(value, default=default).quantize(CENT)


def _duration_ticks(value) -> int | None:
    if value is None:
        return None
    seconds = float(value.total_seconds())
    return int(seconds * 10_000_000)


def _ticks_to_duration(value: int | None):
    if value is None:
        return None
    return timedelta(microseconds=int(value / 10))


@dataclass
class _ImportBundle:
    tags: list
    tasks: list
    rewards: list
    user: dict
    metadata: dict


class TaskAppPortabilityService:
    """Import/export between taskweb profile data and TaskApp ZIP archive format."""

    @classmethod
    def export_profile_archive(
        cls,
        *,
        profile: Profile,
        user,
        export_timezone: str | None = None,
    ) -> tuple[bytes, str]:
        _ensure_owner(profile, user)
        due_export_tz: ZoneInfo | None = None
        if export_timezone:
            try:
                due_export_tz = ZoneInfo(export_timezone)
            except Exception:
                due_export_tz = None

        payload = io.BytesIO()
        with zipfile.ZipFile(payload, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            metadata = {
                "ExportedAt": _iso_datetime(timezone.now()),
                "AppVersion": "1.0.0",
                "UserName": profile.name,
                "OriginalUserId": str(profile.id),
            }
            archive.writestr("metadata.json", json.dumps(metadata, indent=2))

            tags_data = cls._export_tags(profile)
            tasks_data = cls._export_tasks(profile, due_export_tz=due_export_tz)
            rewards_data = cls._export_rewards(profile)
            user_data = {"Id": str(profile.id), "Gold": float(profile.gold_balance)}

            archive.writestr("data/tags.json", json.dumps(tags_data, indent=2))
            archive.writestr("data/tasks.json", json.dumps(tasks_data, indent=2))
            archive.writestr("data/rewards.json", json.dumps(rewards_data, indent=2))
            archive.writestr("data/user.json", json.dumps(user_data, indent=2))

            logs_db_bytes = cls._export_logs_db(profile)
            archive.writestr("data/logs.db", logs_db_bytes)

        filename = f"{profile.name.replace(' ', '_')}.taskapp"
        return payload.getvalue(), filename

    @classmethod
    def import_profile_archive(
        cls,
        *,
        profile: Profile,
        user,
        archive_file,
        import_timezone: str | None = None,
    ) -> dict:
        _ensure_owner(profile, user)

        try:
            data = archive_file.read()
        except Exception as exc:  # pragma: no cover - defensive
            raise ValidationError({"file": f"Failed to read uploaded file: {exc}"}) from exc

        try:
            with zipfile.ZipFile(io.BytesIO(data), "r") as archive:
                bundle = cls._read_bundle(archive)
                logs_rows = cls._read_logs_rows(archive)
        except zipfile.BadZipFile as exc:
            raise ValidationError({"file": "Invalid archive format."}) from exc

        with transaction.atomic():
            locked_profile = Profile.objects.select_for_update().get(id=profile.id)
            result = cls._import_bundle(
                locked_profile,
                bundle,
                logs_rows,
                import_timezone=import_timezone,
            )

        return result

    @classmethod
    def _export_tags(cls, profile: Profile) -> list[dict]:
        tags = Tag.objects.filter(profile=profile).order_by("name")
        return [{"Id": str(tag.id), "Name": tag.name} for tag in tags]

    @classmethod
    def _export_tasks(cls, profile: Profile, *, due_export_tz: ZoneInfo | None = None) -> list[dict]:
        tasks = (
            Task.objects.filter(profile=profile)
            .exclude(task_type=Task.TaskType.REWARD)
            .prefetch_related("tags", "checklist_items", "streak_bonus_rules")
            .order_by("created_at")
        )
        data = []
        for task in tasks:
            entry = {
                "$type": {
                    Task.TaskType.TODO: "Todo",
                    Task.TaskType.DAILY: "Daily",
                    Task.TaskType.HABIT: "Habit",
                }[task.task_type],
                "Id": str(task.id),
                "CreatedAt": _iso_datetime(task.created_at),
                "Title": task.title,
                "Notes": task.notes or None,
                "Tags": [{"Id": str(tag.id), "Name": tag.name} for tag in task.tags.all()],
                "LastCompletedDate": _iso_datetime(task.completed_at or task.last_action_at),
                "GoldReward": float(task.gold_delta),
                "IsHidden": bool(task.is_hidden),
            }
            if task.task_type == Task.TaskType.TODO:
                # TaskApp consumes todo due dates as wall-time with timezone offset.
                # Exporting in the requester's timezone preserves the expected due wall-time in TaskApp.
                entry["DueDate"] = _iso_datetime_in_zone(task.due_at, target_tz=due_export_tz)
                entry["Checklist"] = [
                    {
                        "Id": str(item.id),
                        "Text": item.text,
                        "IsCompleted": bool(item.is_completed),
                    }
                    for item in task.checklist_items.all().order_by("sort_order", "created_at")
                ]
            elif task.task_type == Task.TaskType.DAILY:
                entry["Cadence"] = {
                    Task.Cadence.DAY: 0,
                    Task.Cadence.WEEK: 1,
                    Task.Cadence.MONTH: 2,
                    Task.Cadence.YEAR: 3,
                }.get(task.repeat_cadence or Task.Cadence.DAY, 0)
                entry["RepeatEvery"] = int(task.repeat_every)
                entry["CurrentStreak"] = int(task.current_streak)
                entry["BestStreak"] = int(task.best_streak)
                entry["LastCompletionPeriod"] = (
                    task.last_completion_period.isoformat() if task.last_completion_period else None
                )
                entry["RewardGoalFulfilled"] = task.current_streak >= max(task.streak_goal, 1)
                entry["AutocompleteTimeThresholdTicks"] = _duration_ticks(task.autocomplete_time_threshold)
                entry["StreakBonusRules"] = [
                    {
                        "StreakGoal": int(rule.streak_goal),
                        "BonusPercent": float(rule.bonus_percent),
                    }
                    for rule in task.streak_bonus_rules.all().order_by("streak_goal")
                ]
            elif task.task_type == Task.TaskType.HABIT:
                entry["Count"] = float(task.current_count)
                entry["IncrementAmount"] = float(task.count_increment)
                entry["IncrementEnabled"] = True
                entry["DecrementEnabled"] = False
                entry["ResetCadence"] = {
                    None: 0,
                    Task.Cadence.DAY: 1,
                    Task.Cadence.WEEK: 2,
                    Task.Cadence.MONTH: 3,
                }.get(task.count_reset_cadence, 0)
                entry["LastResetPeriod"] = None
            data.append(entry)
        return data

    @classmethod
    def _export_rewards(cls, profile: Profile) -> list[dict]:
        rewards = Task.objects.filter(profile=profile, task_type=Task.TaskType.REWARD).prefetch_related("tags").order_by("created_at")
        return [
            {
                "Id": str(reward.id),
                "CreatedAt": _iso_datetime(reward.created_at),
                "Title": reward.title,
                "Notes": reward.notes or None,
                "IsClaimed": bool(reward.is_claimed),
                "IsRepeatable": bool(reward.is_repeatable),
                "ClaimCount": int(reward.claim_count),
                "ClaimedAt": _iso_datetime(reward.claimed_at),
                "GoldCost": float(abs(reward.gold_delta)),
                "Tags": [{"Id": str(tag.id), "Name": tag.name} for tag in reward.tags.all()],
                "IsHidden": bool(reward.is_hidden),
            }
            for reward in rewards
        ]

    @classmethod
    def _export_logs_db(cls, profile: Profile) -> bytes:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "logs.db"
            connection = sqlite3.connect(db_path)
            try:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS LogEntries (
                        Id TEXT PRIMARY KEY,
                        Timestamp TEXT NOT NULL,
                        Type INTEGER NOT NULL,
                        TaskId TEXT NULL,
                        RewardId TEXT NULL,
                        GoldDelta REAL NOT NULL,
                        UserGold REAL NOT NULL DEFAULT 0,
                        CountDelta REAL NULL,
                        DurationTicks INTEGER NULL,
                        TitleSnapshot TEXT NOT NULL
                    );
                    """
                )

                logs = LogEntry.objects.filter(profile=profile).order_by("timestamp")
                rows = []
                for log in logs:
                    rows.append(
                        (
                            str(log.id),
                            _iso_datetime(log.timestamp),
                            TASKAPP_LOG_TYPE_REVERSE_MAP.get(log.type, 0),
                            str(log.task_id) if log.task_id else None,
                            str(log.reward_id) if log.reward_id else None,
                            float(log.gold_delta),
                            float(log.user_gold),
                            float(log.count_delta) if log.count_delta is not None else None,
                            _duration_ticks(log.duration),
                            log.title_snapshot or "",
                        )
                    )

                connection.executemany(
                    """
                    INSERT INTO LogEntries
                    (Id, Timestamp, Type, TaskId, RewardId, GoldDelta, UserGold, CountDelta, DurationTicks, TitleSnapshot)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    rows,
                )
                connection.commit()
            finally:
                connection.close()

            return db_path.read_bytes()

    @classmethod
    def _read_bundle(cls, archive: zipfile.ZipFile) -> _ImportBundle:
        def _read_json(path: str, default):
            try:
                with archive.open(path) as handle:
                    return json.load(handle)
            except KeyError:
                return default

        return _ImportBundle(
            tags=_read_json("data/tags.json", []),
            tasks=_read_json("data/tasks.json", []),
            rewards=_read_json("data/rewards.json", []),
            user=_read_json("data/user.json", {}),
            metadata=_read_json("metadata.json", {}),
        )

    @classmethod
    def _read_logs_rows(cls, archive: zipfile.ZipFile) -> list[dict]:
        try:
            with archive.open("data/logs.db") as source:
                logs_bytes = source.read()
        except KeyError:
            return []

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "logs.db"
            db_path.write_bytes(logs_bytes)
            # TaskApp may export SQLite WAL sidecar files; include them so uncheckpointed rows are visible.
            try:
                with archive.open("data/logs.db-wal") as wal_source:
                    (Path(tmpdir) / "logs.db-wal").write_bytes(wal_source.read())
            except KeyError:
                pass
            try:
                with archive.open("data/logs.db-shm") as shm_source:
                    (Path(tmpdir) / "logs.db-shm").write_bytes(shm_source.read())
            except KeyError:
                pass
            connection = sqlite3.connect(db_path)
            connection.row_factory = sqlite3.Row
            try:
                cursor = connection.execute(
                    """
                    SELECT Id, Timestamp, Type, TaskId, RewardId, GoldDelta, UserGold, CountDelta, DurationTicks, TitleSnapshot
                    FROM LogEntries
                    ORDER BY Timestamp ASC
                    """
                )
                return [dict(row) for row in cursor.fetchall()]
            except sqlite3.Error:
                return []
            finally:
                connection.close()

    @classmethod
    def _import_bundle(
        cls,
        profile: Profile,
        bundle: _ImportBundle,
        logs_rows: list[dict],
        *,
        import_timezone: str | None = None,
    ) -> dict:
        wall_time_tz: ZoneInfo | None = None
        if import_timezone:
            try:
                wall_time_tz = ZoneInfo(import_timezone)
            except Exception:
                wall_time_tz = None

        imported_counts = {
            "tags": 0,
            "tasks": 0,
            "rewards": 0,
            "checklist_items": 0,
            "streak_bonus_rules": 0,
            "logs": 0,
            "logs_skipped": 0,
        }

        tag_id_map: dict[str, Tag] = {}
        task_id_map: dict[str, Task] = {}

        # Normalize tags.json legacy format (string[] fallback)
        normalized_tags = []
        for raw in bundle.tags or []:
            if isinstance(raw, str):
                normalized_tags.append({"Name": raw})
            elif isinstance(raw, dict):
                normalized_tags.append(raw)

        for tag_payload in normalized_tags:
            tag = cls._upsert_tag(profile, tag_payload)
            if tag:
                key = str(tag_payload.get("Id") or "")
                if key:
                    tag_id_map[key] = tag
                imported_counts["tags"] += 1

        for task_payload in bundle.tasks or []:
            task = cls._import_task(
                profile,
                task_payload,
                tag_id_map,
                imported_counts,
                due_wall_time_tz=wall_time_tz,
            )
            if task:
                old_id = str(task_payload.get("Id") or "")
                if old_id:
                    task_id_map[old_id] = task
                imported_counts["tasks"] += 1

        for reward_payload in bundle.rewards or []:
            reward_task = cls._import_reward(profile, reward_payload, tag_id_map)
            if reward_task:
                old_id = str(reward_payload.get("Id") or "")
                if old_id:
                    task_id_map[old_id] = reward_task
                imported_counts["rewards"] += 1

        for row in logs_rows:
            if cls._import_log_row(profile, row, task_id_map):
                imported_counts["logs"] += 1
            else:
                imported_counts["logs_skipped"] += 1

        imported_gold = _to_cents(bundle.user.get("Gold"), default=str(profile.gold_balance))
        if imported_gold < Decimal("0"):
            imported_gold = Decimal("0")
        profile.gold_balance = imported_gold
        profile.save(update_fields=["gold_balance"])

        return {
            "profile_id": str(profile.id),
            "imported": imported_counts,
            "metadata": bundle.metadata,
        }

    @classmethod
    def _safe_uuid_for(cls, model, value) -> uuid.UUID:
        try:
            parsed = uuid.UUID(str(value))
        except Exception:
            parsed = uuid.uuid4()
        if model.objects.filter(id=parsed).exists():
            return uuid.uuid4()
        return parsed

    @classmethod
    def _upsert_tag(cls, profile: Profile, payload: dict) -> Tag | None:
        name = (payload.get("Name") or "").strip()
        if not name:
            return None
        tag = Tag.objects.filter(profile=profile, name=name).first()
        if tag:
            return tag
        tag = Tag(id=cls._safe_uuid_for(Tag, payload.get("Id")), profile=profile, name=name)
        tag.full_clean()
        tag.save()
        return tag

    @classmethod
    def _task_payload_type(cls, payload: dict) -> str:
        discriminator = payload.get("$type") or payload.get("type") or payload.get("TaskType")
        if isinstance(discriminator, str):
            return discriminator.lower()
        return ""

    @classmethod
    def _cadence_from_taskapp(cls, value, *, allow_never: bool) -> str | None:
        mapping_str = {
            "day": Task.Cadence.DAY,
            "daily": Task.Cadence.DAY,
            "week": Task.Cadence.WEEK,
            "weekly": Task.Cadence.WEEK,
            "month": Task.Cadence.MONTH,
            "monthly": Task.Cadence.MONTH,
            "year": Task.Cadence.YEAR,
            "yearly": Task.Cadence.YEAR,
            "never": Task.Cadence.NEVER,
        }
        if isinstance(value, int):
            if allow_never:
                mapped = {
                    0: Task.Cadence.NEVER,
                    1: Task.Cadence.DAY,
                    2: Task.Cadence.WEEK,
                    3: Task.Cadence.MONTH,
                }.get(value)
            else:
                mapped = {
                    0: Task.Cadence.DAY,
                    1: Task.Cadence.WEEK,
                    2: Task.Cadence.MONTH,
                    3: Task.Cadence.YEAR,
                }.get(value)
        else:
            key = str(value or "").strip().lower()
            mapped = mapping_str.get(key)
        if mapped == Task.Cadence.NEVER and not allow_never:
            return Task.Cadence.DAY
        return mapped

    @classmethod
    def _apply_tags(cls, task: Task, payload: dict, tag_id_map: dict[str, Tag]) -> None:
        attached: list[Tag] = []
        for tag_payload in payload.get("Tags") or []:
            if not isinstance(tag_payload, dict):
                continue
            existing = tag_id_map.get(str(tag_payload.get("Id") or ""))
            if existing:
                attached.append(existing)
                continue
            tag = cls._upsert_tag(task.profile, tag_payload)
            if tag:
                attached.append(tag)
                key = str(tag_payload.get("Id") or "")
                if key:
                    tag_id_map[key] = tag
        if attached:
            task.tags.set(attached)

    @classmethod
    def _import_task(
        cls,
        profile: Profile,
        payload: dict,
        tag_id_map: dict[str, Tag],
        imported_counts: dict,
        *,
        due_wall_time_tz: ZoneInfo | None = None,
    ) -> Task | None:
        task_type = cls._task_payload_type(payload)
        mapped_type = {
            "todo": Task.TaskType.TODO,
            "daily": Task.TaskType.DAILY,
            "habit": Task.TaskType.HABIT,
        }.get(task_type)
        if not mapped_type:
            return None

        title = (payload.get("Title") or "").strip()
        if not title:
            return None

        task = Task(
            id=cls._safe_uuid_for(Task, payload.get("Id")),
            profile=profile,
            task_type=mapped_type,
            title=title,
            notes=payload.get("Notes") or "",
            is_hidden=bool(payload.get("IsHidden") or False),
            gold_delta=_to_decimal(payload.get("GoldReward")),
            last_action_at=_parse_datetime(payload.get("LastCompletedDate")),
        )

        if mapped_type == Task.TaskType.TODO:
            task.due_at = _parse_datetime(
                payload.get("DueDate"),
                interpret_as_wall_time_tz=due_wall_time_tz,
            )
            completed_at = _parse_datetime(payload.get("LastCompletedDate"))
            task.is_done = completed_at is not None
            task.completed_at = completed_at
            if task.is_done:
                task.total_actions_count = 1
        elif mapped_type == Task.TaskType.DAILY:
            task.repeat_cadence = cls._cadence_from_taskapp(payload.get("Cadence"), allow_never=False) or Task.Cadence.DAY
            task.repeat_every = max(1, int(payload.get("RepeatEvery") or 1))
            task.current_streak = max(0, int(payload.get("CurrentStreak") or 0))
            task.best_streak = max(task.current_streak, int(payload.get("BestStreak") or 0))
            task.last_completion_period = _parse_date(payload.get("LastCompletionPeriod"))
            if payload.get("AutocompleteTimeThresholdTicks") is not None:
                task.autocomplete_time_threshold = _ticks_to_duration(int(payload.get("AutocompleteTimeThresholdTicks")))
            if task.last_completion_period:
                task.total_actions_count = 1
        elif mapped_type == Task.TaskType.HABIT:
            task.current_count = _to_decimal(payload.get("Count"))
            task.count_increment = _to_decimal(payload.get("IncrementAmount"), default="1") or Decimal("1")
            cadence = cls._cadence_from_taskapp(payload.get("ResetCadence"), allow_never=True)
            task.count_reset_cadence = None if cadence in (None, Task.Cadence.NEVER) else cadence
            if task.current_count != Decimal("0"):
                task.total_actions_count = 1

        task.full_clean()
        task.save()
        created_at = _parse_datetime(payload.get("CreatedAt"))
        if created_at is not None:
            Task.objects.filter(id=task.id).update(created_at=created_at)
            task.created_at = created_at
        cls._apply_tags(task, payload, tag_id_map)

        if mapped_type == Task.TaskType.TODO:
            for index, item_payload in enumerate(payload.get("Checklist") or []):
                text = (item_payload.get("Text") or "").strip() if isinstance(item_payload, dict) else ""
                if not text:
                    continue
                checklist_item = ChecklistItem(
                    id=cls._safe_uuid_for(
                        ChecklistItem, item_payload.get("Id") if isinstance(item_payload, dict) else None
                    ),
                    task=task,
                    text=text,
                    is_completed=bool(item_payload.get("IsCompleted") if isinstance(item_payload, dict) else False),
                    sort_order=index,
                )
                checklist_item.full_clean()
                checklist_item.save()
                imported_counts["checklist_items"] += 1

        if mapped_type == Task.TaskType.DAILY:
            for rule_payload in payload.get("StreakBonusRules") or []:
                if not isinstance(rule_payload, dict):
                    continue
                streak_goal = int(rule_payload.get("StreakGoal") or 0)
                bonus_percent = _to_decimal(rule_payload.get("BonusPercent"))
                if streak_goal < 1:
                    continue
                rule = StreakBonusRule(task=task, streak_goal=streak_goal, bonus_percent=bonus_percent)
                rule.full_clean()
                rule.save()
                imported_counts["streak_bonus_rules"] += 1

        return task

    @classmethod
    def _import_reward(cls, profile: Profile, payload: dict, tag_id_map: dict[str, Tag]) -> Task | None:
        title = (payload.get("Title") or "").strip()
        if not title:
            return None

        gold_cost = _to_decimal(payload.get("GoldCost"))
        if gold_cost < Decimal("0"):
            gold_cost = abs(gold_cost)

        task = Task(
            id=cls._safe_uuid_for(Task, payload.get("Id")),
            profile=profile,
            task_type=Task.TaskType.REWARD,
            title=title,
            notes=payload.get("Notes") or "",
            is_hidden=bool(payload.get("IsHidden") or False),
            gold_delta=-gold_cost,
            is_repeatable=bool(payload.get("IsRepeatable") or False),
            is_claimed=bool(payload.get("IsClaimed") or False),
            claim_count=max(0, int(payload.get("ClaimCount") or 0)),
            claimed_at=_parse_datetime(payload.get("ClaimedAt")),
            last_action_at=_parse_datetime(payload.get("ClaimedAt")),
            total_actions_count=max(0, int(payload.get("ClaimCount") or 0)),
        )
        if task.is_claimed and task.claimed_at is None:
            task.claimed_at = timezone.now()
        task.full_clean()
        task.save()
        created_at = _parse_datetime(payload.get("CreatedAt"))
        if created_at is not None:
            Task.objects.filter(id=task.id).update(created_at=created_at)
            task.created_at = created_at
        cls._apply_tags(task, payload, tag_id_map)
        return task

    @classmethod
    def _import_log_row(cls, profile: Profile, row: dict, task_id_map: dict[str, Task]) -> bool:
        log_type = TASKAPP_LOG_TYPE_MAP.get(int(row.get("Type", -1)))
        if not log_type:
            return False

        task = task_id_map.get(str(row.get("TaskId") or ""))
        reward = task_id_map.get(str(row.get("RewardId") or ""))

        log = LogEntry(
            id=cls._safe_uuid_for(LogEntry, row.get("Id")),
            profile=profile,
            timestamp=_parse_datetime(row.get("Timestamp")) or timezone.now(),
            type=log_type,
            task=task,
            reward=reward if reward and reward.task_type == Task.TaskType.REWARD else None,
            gold_delta=_to_cents(row.get("GoldDelta")),
            user_gold=_to_cents(row.get("UserGold")),
            count_delta=_to_cents(row.get("CountDelta")) if row.get("CountDelta") is not None else None,
            duration=_ticks_to_duration(int(row.get("DurationTicks"))) if row.get("DurationTicks") is not None else None,
            title_snapshot=(row.get("TitleSnapshot") or "")[:200],
        )

        try:
            log.full_clean()
            log.save()
            return True
        except ValidationError:
            return False
