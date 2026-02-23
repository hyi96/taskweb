from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime, parse_duration

from core.models import ChecklistItem, LogEntry, Profile, StreakBonusRule, Tag, Task


LOG_TYPE_MAP = {
    0: LogEntry.LogType.DAILY_COMPLETED,
    1: LogEntry.LogType.HABIT_INCREMENTED,
    2: LogEntry.LogType.TODO_COMPLETED,
    3: LogEntry.LogType.REWARD_CLAIMED,
    4: LogEntry.LogType.ACTIVITY_DURATION,
    "0": LogEntry.LogType.DAILY_COMPLETED,
    "1": LogEntry.LogType.HABIT_INCREMENTED,
    "2": LogEntry.LogType.TODO_COMPLETED,
    "3": LogEntry.LogType.REWARD_CLAIMED,
    "4": LogEntry.LogType.ACTIVITY_DURATION,
}


def _as_uuid(value: Any) -> uuid.UUID | None:
    if value is None or value == "":
        return None
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def _as_decimal(value: Any, default: str = "0") -> Decimal:
    if value is None or value == "":
        return Decimal(default)
    return Decimal(str(value))


def _as_int(value: Any, default: int = 0) -> int:
    if value is None or value == "":
        return default
    return int(value)


def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def _as_date(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    parsed = parse_date(str(value))
    if parsed is None:
        raise ValidationError({"date": f"Invalid date value: {value}"})
    return parsed


def _as_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        dt = parse_datetime(str(value))
    if dt is None:
        raise ValidationError({"datetime": f"Invalid datetime value: {value}"})
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def _as_duration(value: Any):
    if not value:
        return None
    parsed = parse_duration(str(value))
    if parsed is None:
        raise ValidationError({"duration": f"Invalid duration value: {value}"})
    return parsed


def _normalize_log_type(value: Any) -> str:
    mapped = LOG_TYPE_MAP.get(value, value)
    if mapped in {
        LogEntry.LogType.DAILY_COMPLETED,
        LogEntry.LogType.HABIT_INCREMENTED,
        LogEntry.LogType.TODO_COMPLETED,
        LogEntry.LogType.REWARD_CLAIMED,
        LogEntry.LogType.ACTIVITY_DURATION,
    }:
        return mapped
    raise ValidationError({"type": f"Unsupported log type: {value}"})


def _next_uuid_if_conflict(model, candidate: uuid.UUID, **ownership_filters):
    existing = model.objects.filter(id=candidate).first()
    if existing is None:
        return candidate
    for field_name, field_value in ownership_filters.items():
        if getattr(existing, field_name) != field_value:
            return uuid.uuid4()
    return candidate


class LocalToCloudMigrationService:
    @classmethod
    @transaction.atomic
    def migrate(cls, *, profile: Profile, user, payload: dict[str, Any]) -> dict[str, Any]:
        if profile.account_id != user.id:
            raise ValidationError({"profile_id": "Profile does not belong to the authenticated user."})
        if not isinstance(payload, dict):
            raise ValidationError({"detail": "Invalid migration payload."})

        profile = Profile.objects.select_for_update().get(id=profile.id)
        source_profile = payload.get("profile") if isinstance(payload.get("profile"), dict) else {}
        source_profile_id = source_profile.get("id")

        result = {
            "target_profile_id": str(profile.id),
            "source_profile_id": str(source_profile_id) if source_profile_id else None,
            "counts": {
                "tags": {"created": 0, "updated": 0, "skipped": 0, "errors": 0},
                "tasks": {"created": 0, "updated": 0, "skipped": 0, "errors": 0},
                "checklist_items": {"created": 0, "updated": 0, "skipped": 0, "errors": 0},
                "streak_bonus_rules": {"created": 0, "updated": 0, "skipped": 0, "errors": 0},
                "logs": {"created": 0, "updated": 0, "skipped": 0, "errors": 0},
            },
            "id_map": {"tags": {}, "tasks": {}, "checklist_items": {}, "streak_bonus_rules": {}, "logs": {}},
            "errors": [],
        }

        source_balance = source_profile.get("gold_balance")
        if source_balance not in (None, ""):
            profile.gold_balance = _as_decimal(source_balance, default="0")
            profile.full_clean()
            profile.save(update_fields=["gold_balance"])

        tag_map = cls._migrate_tags(profile=profile, payload=payload, result=result)
        task_map = cls._migrate_tasks(profile=profile, payload=payload, result=result, tag_map=tag_map)
        checklist_map = cls._migrate_checklist(profile=profile, payload=payload, result=result, task_map=task_map)
        streak_map = cls._migrate_streak_rules(profile=profile, payload=payload, result=result, task_map=task_map)
        logs_map = cls._migrate_logs(profile=profile, payload=payload, result=result, task_map=task_map)
        result["id_map"]["checklist_items"].update(checklist_map)
        result["id_map"]["streak_bonus_rules"].update(streak_map)
        result["id_map"]["logs"].update(logs_map)

        return result

    @classmethod
    def _items(cls, payload: dict[str, Any], key: str) -> list[dict[str, Any]]:
        value = payload.get(key)
        if not isinstance(value, list):
            return []
        return [item for item in value if isinstance(item, dict)]

    @classmethod
    def _record_error(cls, result: dict[str, Any], bucket: str, item_id: Any, exc: Exception) -> None:
        result["counts"][bucket]["errors"] += 1
        result["errors"].append({"entity": bucket, "id": str(item_id) if item_id else None, "error": str(exc)})

    @classmethod
    def _migrate_tags(cls, *, profile: Profile, payload: dict[str, Any], result: dict[str, Any]) -> dict[str, str]:
        mapping: dict[str, str] = {}
        for item in cls._items(payload, "tags"):
            source_id = _as_uuid(item.get("id"))
            if source_id is None:
                result["counts"]["tags"]["skipped"] += 1
                continue
            source_id_text = str(source_id)
            try:
                existing = Tag.objects.filter(id=source_id, profile=profile).first()
                if existing:
                    existing.name = str(item.get("name", existing.name)).strip() or existing.name
                    existing.full_clean()
                    existing.save(update_fields=["name"])
                    mapping[source_id_text] = str(existing.id)
                    result["counts"]["tags"]["updated"] += 1
                    continue

                by_name = Tag.objects.filter(profile=profile, name=str(item.get("name", "")).strip()).first()
                if by_name:
                    mapping[source_id_text] = str(by_name.id)
                    result["counts"]["tags"]["skipped"] += 1
                    continue

                target_id = _next_uuid_if_conflict(Tag, source_id, profile_id=profile.id)
                tag = Tag(
                    id=target_id,
                    profile=profile,
                    name=str(item.get("name", "")).strip(),
                    is_system=_as_bool(item.get("is_system"), default=False),
                )
                tag.full_clean()
                tag.save(force_insert=True)
                mapping[source_id_text] = str(tag.id)
                result["counts"]["tags"]["created"] += 1
            except Exception as exc:  # noqa: BLE001
                cls._record_error(result, "tags", source_id, exc)
        result["id_map"]["tags"].update(mapping)
        return mapping

    @classmethod
    def _task_fields(cls, item: dict[str, Any]) -> dict[str, Any]:
        return {
            "task_type": item.get("task_type"),
            "title": str(item.get("title", "")).strip(),
            "notes": str(item.get("notes", "")),
            "is_hidden": _as_bool(item.get("is_hidden"), default=False),
            "gold_delta": _as_decimal(item.get("gold_delta"), default="0"),
            "current_count": _as_decimal(item.get("current_count"), default="0"),
            "count_increment": _as_decimal(item.get("count_increment"), default="1"),
            "count_reset_cadence": item.get("count_reset_cadence") or None,
            "repeat_cadence": item.get("repeat_cadence") or None,
            "repeat_every": _as_int(item.get("repeat_every"), default=1),
            "current_streak": _as_int(item.get("current_streak"), default=0),
            "best_streak": _as_int(item.get("best_streak"), default=0),
            "streak_goal": _as_int(item.get("streak_goal"), default=0),
            "last_completion_period": _as_date(item.get("last_completion_period")),
            "autocomplete_time_threshold": _as_duration(item.get("autocomplete_time_threshold")),
            "due_at": _as_datetime(item.get("due_at")),
            "is_done": _as_bool(item.get("is_done"), default=False),
            "completed_at": _as_datetime(item.get("completed_at")),
            "is_repeatable": _as_bool(item.get("is_repeatable"), default=False),
            "is_claimed": _as_bool(item.get("is_claimed"), default=False),
            "claimed_at": _as_datetime(item.get("claimed_at")),
            "claim_count": _as_int(item.get("claim_count"), default=0),
            "total_actions_count": _as_int(item.get("total_actions_count"), default=0),
            "last_action_at": _as_datetime(item.get("last_action_at")),
        }

    @classmethod
    def _migrate_tasks(
        cls,
        *,
        profile: Profile,
        payload: dict[str, Any],
        result: dict[str, Any],
        tag_map: dict[str, str],
    ) -> dict[str, str]:
        mapping: dict[str, str] = {}
        for item in cls._items(payload, "tasks"):
            source_id = _as_uuid(item.get("id"))
            if source_id is None:
                result["counts"]["tasks"]["skipped"] += 1
                continue
            source_id_text = str(source_id)
            try:
                fields = cls._task_fields(item)
                existing = Task.objects.filter(id=source_id, profile=profile).first()
                if existing:
                    for field_name, field_value in fields.items():
                        setattr(existing, field_name, field_value)
                    existing.full_clean()
                    existing.save()
                    result["counts"]["tasks"]["updated"] += 1
                    target_task = existing
                else:
                    target_id = _next_uuid_if_conflict(Task, source_id, profile_id=profile.id)
                    target_task = Task(id=target_id, profile=profile, **fields)
                    target_task.full_clean()
                    target_task.save(force_insert=True)
                    result["counts"]["tasks"]["created"] += 1

                incoming_tag_ids = item.get("tag_ids") if isinstance(item.get("tag_ids"), list) else []
                target_tag_ids = []
                for tag_id in incoming_tag_ids:
                    remapped = tag_map.get(str(tag_id), str(tag_id))
                    if Tag.objects.filter(id=remapped, profile=profile).exists():
                        target_tag_ids.append(remapped)
                target_task.tags.set(target_tag_ids)
                mapping[source_id_text] = str(target_task.id)
            except Exception as exc:  # noqa: BLE001
                cls._record_error(result, "tasks", source_id, exc)
        result["id_map"]["tasks"].update(mapping)
        return mapping

    @classmethod
    def _migrate_checklist(
        cls,
        *,
        profile: Profile,
        payload: dict[str, Any],
        result: dict[str, Any],
        task_map: dict[str, str],
    ) -> dict[str, str]:
        mapping: dict[str, str] = {}
        for item in cls._items(payload, "checklist_items"):
            source_id = _as_uuid(item.get("id"))
            source_task_id = _as_uuid(item.get("task_id"))
            if source_id is None or source_task_id is None:
                result["counts"]["checklist_items"]["skipped"] += 1
                continue
            source_id_text = str(source_id)
            target_task_id = task_map.get(str(source_task_id), str(source_task_id))
            target_task = Task.objects.filter(id=target_task_id, profile=profile, task_type=Task.TaskType.TODO).first()
            if target_task is None:
                result["counts"]["checklist_items"]["skipped"] += 1
                continue
            try:
                existing = ChecklistItem.objects.filter(id=source_id, task__profile=profile).first()
                if existing:
                    existing.task = target_task
                    existing.text = str(item.get("text", existing.text))
                    existing.is_completed = _as_bool(item.get("is_completed"), default=existing.is_completed)
                    existing.sort_order = _as_int(item.get("sort_order"), default=existing.sort_order)
                    existing.full_clean()
                    existing.save(update_fields=["task", "text", "is_completed", "sort_order"])
                    mapping[source_id_text] = str(existing.id)
                    result["counts"]["checklist_items"]["updated"] += 1
                    continue

                target_id = _next_uuid_if_conflict(ChecklistItem, source_id, task_id=target_task.id)
                checklist = ChecklistItem(
                    id=target_id,
                    task=target_task,
                    text=str(item.get("text", "")).strip(),
                    is_completed=_as_bool(item.get("is_completed"), default=False),
                    sort_order=_as_int(item.get("sort_order"), default=0),
                )
                checklist.full_clean()
                checklist.save(force_insert=True)
                mapping[source_id_text] = str(checklist.id)
                result["counts"]["checklist_items"]["created"] += 1
            except Exception as exc:  # noqa: BLE001
                cls._record_error(result, "checklist_items", source_id, exc)
        return mapping

    @classmethod
    def _migrate_streak_rules(
        cls,
        *,
        profile: Profile,
        payload: dict[str, Any],
        result: dict[str, Any],
        task_map: dict[str, str],
    ) -> dict[str, str]:
        mapping: dict[str, str] = {}
        for item in cls._items(payload, "streak_bonus_rules"):
            source_id = _as_uuid(item.get("id"))
            source_task_id = _as_uuid(item.get("task_id"))
            if source_id is None or source_task_id is None:
                result["counts"]["streak_bonus_rules"]["skipped"] += 1
                continue
            source_id_text = str(source_id)
            target_task_id = task_map.get(str(source_task_id), str(source_task_id))
            target_task = Task.objects.filter(id=target_task_id, profile=profile, task_type=Task.TaskType.DAILY).first()
            if target_task is None:
                result["counts"]["streak_bonus_rules"]["skipped"] += 1
                continue
            try:
                existing = StreakBonusRule.objects.filter(id=source_id, task__profile=profile).first()
                if existing:
                    existing.task = target_task
                    existing.streak_goal = _as_int(item.get("streak_goal"), default=existing.streak_goal)
                    existing.bonus_percent = _as_decimal(item.get("bonus_percent"), default="0")
                    existing.full_clean()
                    existing.save(update_fields=["task", "streak_goal", "bonus_percent"])
                    mapping[source_id_text] = str(existing.id)
                    result["counts"]["streak_bonus_rules"]["updated"] += 1
                    continue

                target_id = _next_uuid_if_conflict(StreakBonusRule, source_id, task_id=target_task.id)
                rule = StreakBonusRule(
                    id=target_id,
                    task=target_task,
                    streak_goal=_as_int(item.get("streak_goal"), default=1),
                    bonus_percent=_as_decimal(item.get("bonus_percent"), default="0"),
                )
                rule.full_clean()
                rule.save(force_insert=True)
                mapping[source_id_text] = str(rule.id)
                result["counts"]["streak_bonus_rules"]["created"] += 1
            except Exception as exc:  # noqa: BLE001
                cls._record_error(result, "streak_bonus_rules", source_id, exc)
        return mapping

    @classmethod
    def _migrate_logs(
        cls,
        *,
        profile: Profile,
        payload: dict[str, Any],
        result: dict[str, Any],
        task_map: dict[str, str],
    ) -> dict[str, str]:
        mapping: dict[str, str] = {}
        for item in cls._items(payload, "logs"):
            source_id = _as_uuid(item.get("id"))
            if source_id is None:
                result["counts"]["logs"]["skipped"] += 1
                continue
            source_id_text = str(source_id)
            try:
                target_task_id = item.get("task_id")
                mapped_task_id = task_map.get(str(target_task_id), str(target_task_id)) if target_task_id else None
                task = Task.objects.filter(id=mapped_task_id, profile=profile).first() if mapped_task_id else None

                target_reward_id = item.get("reward_id")
                mapped_reward_id = task_map.get(str(target_reward_id), str(target_reward_id)) if target_reward_id else None
                reward = (
                    Task.objects.filter(id=mapped_reward_id, profile=profile, task_type=Task.TaskType.REWARD).first()
                    if mapped_reward_id
                    else None
                )

                fields = {
                    "profile": profile,
                    "timestamp": _as_datetime(item.get("timestamp")) or timezone.now(),
                    "type": _normalize_log_type(item.get("type")),
                    "task": task,
                    "reward": reward,
                    "gold_delta": _as_decimal(item.get("gold_delta"), default="0"),
                    "user_gold": _as_decimal(item.get("user_gold"), default="0"),
                    "count_delta": _as_decimal(item.get("count_delta"), default="0") if item.get("count_delta") not in (None, "") else None,
                    "duration": _as_duration(item.get("duration")),
                    "title_snapshot": str(item.get("title_snapshot", "")),
                }

                existing = LogEntry.objects.filter(id=source_id, profile=profile).first()
                if existing:
                    for field_name, field_value in fields.items():
                        setattr(existing, field_name, field_value)
                    existing.full_clean()
                    existing.save()
                    mapping[source_id_text] = str(existing.id)
                    result["counts"]["logs"]["updated"] += 1
                    continue

                target_id = _next_uuid_if_conflict(LogEntry, source_id, profile_id=profile.id)
                log = LogEntry(id=target_id, **fields)
                log.full_clean()
                log.save(force_insert=True)
                mapping[source_id_text] = str(log.id)
                result["counts"]["logs"]["created"] += 1
            except IntegrityError as exc:
                cls._record_error(result, "logs", source_id, exc)
            except Exception as exc:  # noqa: BLE001
                cls._record_error(result, "logs", source_id, exc)
        return mapping
