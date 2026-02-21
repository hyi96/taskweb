from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from core.models import LogEntry, Profile, Task
from core.services.periods import (
    daily_period_start,
    habit_reset_period_start,
    local_date_from_dt,
    previous_daily_period_start,
)

CENT = Decimal("0.01")


def _as_aware_timestamp(value: datetime | None) -> datetime:
    ts = value or timezone.now()
    if timezone.is_naive(ts):
        return timezone.make_aware(ts, timezone.get_current_timezone())
    return ts


def _to_cents(value: Decimal) -> Decimal:
    return value.quantize(CENT)


def _lock_task_and_profile(*, task_id, profile_id):
    profile = Profile.objects.select_for_update().get(id=profile_id)
    task = Task.objects.select_for_update().get(id=task_id)
    return task, profile


def _assert_ownership(*, task: Task, profile: Profile, user) -> None:
    """Enforce tenant ownership: task -> profile and profile -> authenticated account."""
    if task.profile_id != profile.id:
        raise ValidationError({"profile_id": "Task does not belong to the selected profile."})
    if profile.account_id != user.id:
        raise ValidationError({"profile_id": "Profile does not belong to the authenticated user."})


def _save_task_profile_log(*, task: Task, profile: Profile, log: LogEntry, task_fields: list[str]) -> None:
    """Persist task/profile/log in one unit after model-level validation."""
    task.full_clean()
    task.save(update_fields=task_fields + ["updated_at"])
    profile.full_clean()
    profile.save(update_fields=["gold_balance"])
    log.full_clean()
    log.save()


def _get_daily_period_start_for_task(*, task: Task, target_date):
    anchor = timezone.localtime(task.created_at).date()
    cadence = task.repeat_cadence or Task.Cadence.DAY
    return daily_period_start(
        target_date=target_date,
        cadence=cadence,
        repeat_every=task.repeat_every,
        anchor_date=anchor,
    )


def _apply_habit_reset_if_needed(*, task: Task, today):
    cadence = task.count_reset_cadence
    if cadence in {None, "", Task.Cadence.NEVER}:
        return False
    if task.current_count == 0:
        return False
    anchor_dt = task.last_action_at or task.created_at
    anchor_date = timezone.localtime(anchor_dt).date()
    current_period = habit_reset_period_start(target_date=today, cadence=cadence)
    anchor_period = habit_reset_period_start(target_date=anchor_date, cadence=cadence)
    if anchor_period >= current_period:
        return False
    task.current_count = Decimal("0.00")
    return True


@transaction.atomic
def refresh_profile_period_state(*, profile: Profile, user, timestamp: datetime | None = None) -> None:
    """Refresh cadence-driven task state at read-time (daily streak rollover, habit reset rollover)."""
    now = _as_aware_timestamp(timestamp)
    today = local_date_from_dt(now)

    locked_profile = Profile.objects.select_for_update().get(id=profile.id)
    if locked_profile.account_id != user.id:
        raise ValidationError({"profile_id": "Profile does not belong to the authenticated user."})

    dailies = list(Task.objects.select_for_update().filter(profile=locked_profile, task_type=Task.TaskType.DAILY))
    habits = list(Task.objects.select_for_update().filter(profile=locked_profile, task_type=Task.TaskType.HABIT))

    for daily in dailies:
        if daily.last_completion_period is None:
            continue
        current_period = _get_daily_period_start_for_task(task=daily, target_date=today)
        expected_prev = previous_daily_period_start(
            current_period_start=current_period,
            cadence=daily.repeat_cadence or Task.Cadence.DAY,
            repeat_every=daily.repeat_every,
        )
        if daily.last_completion_period < expected_prev and daily.current_streak != 0:
            daily.current_streak = 0
            daily.full_clean()
            daily.save(update_fields=["current_streak", "updated_at"])

    for habit in habits:
        if _apply_habit_reset_if_needed(task=habit, today=today):
            habit.full_clean()
            habit.save(update_fields=["current_count", "updated_at"])


@transaction.atomic
def habit_increment(
    *,
    task: Task,
    profile: Profile,
    user,
    by: Decimal | None,
    timestamp: datetime,
) -> Task:
    """Increment a habit count and append a HabitIncremented log atomically."""
    timestamp = _as_aware_timestamp(timestamp)
    task, profile = _lock_task_and_profile(task_id=task.id, profile_id=profile.id)
    _assert_ownership(task=task, profile=profile, user=user)
    if task.task_type != Task.TaskType.HABIT:
        raise ValidationError({"task_type": "This action is only valid for habit tasks."})

    delta_count = by if by is not None else task.count_increment
    task.current_count = _to_cents(task.current_count + delta_count)
    task.total_actions_count += 1
    task.last_action_at = timestamp

    gold_delta = _to_cents(task.gold_delta)
    profile.gold_balance = _to_cents(profile.gold_balance + gold_delta)

    log = LogEntry(
        profile=profile,
        timestamp=timestamp,
        type=LogEntry.LogType.HABIT_INCREMENTED,
        task=task,
        reward=None,
        gold_delta=gold_delta,
        user_gold=profile.gold_balance,
        count_delta=_to_cents(delta_count),
        duration=None,
        title_snapshot=task.title,
    )

    _save_task_profile_log(
        task=task,
        profile=profile,
        log=log,
        task_fields=["current_count", "total_actions_count", "last_action_at"],
    )
    return task


@transaction.atomic
def daily_complete(
    *,
    task: Task,
    profile: Profile,
    user,
    timestamp: datetime,
    completion_period: date | None = None,
) -> Task:
    """Complete a daily once per period and apply the highest eligible streak bonus."""
    timestamp = _as_aware_timestamp(timestamp)
    task, profile = _lock_task_and_profile(task_id=task.id, profile_id=profile.id)
    _assert_ownership(task=task, profile=profile, user=user)
    if task.task_type != Task.TaskType.DAILY:
        raise ValidationError({"task_type": "This action is only valid for daily tasks."})

    input_date = completion_period or local_date_from_dt(timestamp)
    period = _get_daily_period_start_for_task(task=task, target_date=input_date)
    if task.last_completion_period == period:
        raise ValidationError({"completion_period": "Task is already completed for this period."})

    previous_period = previous_daily_period_start(
        current_period_start=period,
        cadence=task.repeat_cadence or Task.Cadence.DAY,
        repeat_every=task.repeat_every,
    )
    if task.last_completion_period == previous_period:
        task.current_streak += 1
    else:
        task.current_streak = 1

    task.last_completion_period = period
    task.best_streak = max(task.best_streak, task.current_streak)
    task.last_action_at = timestamp
    task.total_actions_count += 1

    base_gold = _to_cents(task.gold_delta)
    max_bonus_rule = (
        task.streak_bonus_rules.filter(streak_goal__lte=task.current_streak)
        .order_by("-bonus_percent")
        .first()
    )
    bonus_percent = max_bonus_rule.bonus_percent if max_bonus_rule else Decimal("0")
    final_gold = _to_cents(base_gold * (Decimal("1") + (bonus_percent / Decimal("100"))))

    profile.gold_balance = _to_cents(profile.gold_balance + final_gold)

    log = LogEntry(
        profile=profile,
        timestamp=timestamp,
        type=LogEntry.LogType.DAILY_COMPLETED,
        task=task,
        reward=None,
        gold_delta=final_gold,
        user_gold=profile.gold_balance,
        count_delta=None,
        duration=None,
        title_snapshot=task.title,
    )

    _save_task_profile_log(
        task=task,
        profile=profile,
        log=log,
        task_fields=[
            "last_completion_period",
            "current_streak",
            "best_streak",
            "last_action_at",
            "total_actions_count",
        ],
    )
    return task


def get_uncompleted_dailies_from_previous_period(*, profile: Profile, user, timestamp: datetime | None = None):
    now = _as_aware_timestamp(timestamp)
    today = local_date_from_dt(now)
    if profile.account_id != user.id:
        raise ValidationError({"profile_id": "Profile does not belong to the authenticated user."})

    results = []
    dailies = Task.objects.filter(profile=profile, task_type=Task.TaskType.DAILY).order_by("title")
    for daily in dailies:
        current_period = _get_daily_period_start_for_task(task=daily, target_date=today)
        previous_period = previous_daily_period_start(
            current_period_start=current_period,
            cadence=daily.repeat_cadence or Task.Cadence.DAY,
            repeat_every=daily.repeat_every,
        )
        # If task is already completed in the current period, do not prompt
        # "new day" backfill for the previous period.
        if daily.last_completion_period == current_period:
            continue
        if current_period == previous_period:
            continue
        if daily.last_completion_period == previous_period:
            continue
        results.append(
            {
                "id": str(daily.id),
                "title": daily.title,
                "previous_period_start": previous_period.isoformat(),
                "last_completion_period": daily.last_completion_period.isoformat() if daily.last_completion_period else None,
                "repeat_cadence": daily.repeat_cadence,
                "repeat_every": daily.repeat_every,
            }
        )
    return results


@transaction.atomic
def start_new_day(
    *,
    profile: Profile,
    user,
    checked_daily_ids: list,
    timestamp: datetime | None = None,
):
    now = _as_aware_timestamp(timestamp)
    today = local_date_from_dt(now)
    locked_profile = Profile.objects.select_for_update().get(id=profile.id)
    if locked_profile.account_id != user.id:
        raise ValidationError({"profile_id": "Profile does not belong to the authenticated user."})

    updated = 0
    checked_set = {str(value) for value in checked_daily_ids}
    dailies = list(
        Task.objects.select_for_update().filter(profile=locked_profile, task_type=Task.TaskType.DAILY, id__in=checked_set)
    )
    for daily in dailies:
        current_period = _get_daily_period_start_for_task(task=daily, target_date=today)
        previous_period = previous_daily_period_start(
            current_period_start=current_period,
            cadence=daily.repeat_cadence or Task.Cadence.DAY,
            repeat_every=daily.repeat_every,
        )
        # Never overwrite a completion already recorded in current period.
        if daily.last_completion_period == current_period:
            continue
        if daily.last_completion_period == previous_period:
            continue
        if daily.last_completion_period:
            expected_prev = previous_daily_period_start(
                current_period_start=previous_period,
                cadence=daily.repeat_cadence or Task.Cadence.DAY,
                repeat_every=daily.repeat_every,
            )
            daily.current_streak = daily.current_streak + 1 if daily.last_completion_period == expected_prev else 1
        else:
            daily.current_streak = 1
        daily.best_streak = max(daily.best_streak, daily.current_streak)
        daily.last_completion_period = previous_period
        daily.full_clean()
        daily.save(update_fields=["current_streak", "best_streak", "last_completion_period", "updated_at"])
        updated += 1

    refresh_profile_period_state(profile=locked_profile, user=user, timestamp=now)
    return {"updated_count": updated}


@transaction.atomic
def todo_complete(
    *,
    task: Task,
    profile: Profile,
    user,
    timestamp: datetime,
) -> Task:
    """Mark todo complete once and append a TodoCompleted log atomically."""
    timestamp = _as_aware_timestamp(timestamp)
    task, profile = _lock_task_and_profile(task_id=task.id, profile_id=profile.id)
    _assert_ownership(task=task, profile=profile, user=user)
    if task.task_type != Task.TaskType.TODO:
        raise ValidationError({"task_type": "This action is only valid for todo tasks."})
    if task.is_done:
        raise ValidationError({"is_done": "Todo task is already completed."})

    task.is_done = True
    task.completed_at = timestamp
    task.last_action_at = timestamp
    task.total_actions_count += 1

    gold_delta = _to_cents(task.gold_delta)
    profile.gold_balance = _to_cents(profile.gold_balance + gold_delta)

    log = LogEntry(
        profile=profile,
        timestamp=timestamp,
        type=LogEntry.LogType.TODO_COMPLETED,
        task=task,
        reward=None,
        gold_delta=gold_delta,
        user_gold=profile.gold_balance,
        count_delta=None,
        duration=None,
        title_snapshot=task.title,
    )

    _save_task_profile_log(
        task=task,
        profile=profile,
        log=log,
        task_fields=["is_done", "completed_at", "last_action_at", "total_actions_count"],
    )
    return task


@transaction.atomic
def reward_claim(
    *,
    task: Task,
    profile: Profile,
    user,
    timestamp: datetime,
) -> Task:
    """Claim a reward by spending gold, guarding repeatability and non-negative balance."""
    timestamp = _as_aware_timestamp(timestamp)
    task, profile = _lock_task_and_profile(task_id=task.id, profile_id=profile.id)
    _assert_ownership(task=task, profile=profile, user=user)
    if task.task_type != Task.TaskType.REWARD:
        raise ValidationError({"task_type": "This action is only valid for reward tasks."})
    if task.gold_delta >= 0:
        raise ValidationError({"gold_delta": "Reward cost must be negative."})
    if not task.is_repeatable and task.is_claimed:
        raise ValidationError({"is_claimed": "Reward has already been claimed."})
    if _to_cents(profile.gold_balance + task.gold_delta) < 0:
        raise ValidationError({"gold_balance": "Insufficient funds to claim this reward."})

    profile.gold_balance = _to_cents(profile.gold_balance + task.gold_delta)
    task.claim_count += 1
    task.is_claimed = True
    task.claimed_at = timestamp
    task.last_action_at = timestamp
    task.total_actions_count += 1

    gold_delta = _to_cents(task.gold_delta)
    log = LogEntry(
        profile=profile,
        timestamp=timestamp,
        type=LogEntry.LogType.REWARD_CLAIMED,
        task=task,
        reward=task,
        gold_delta=gold_delta,
        user_gold=profile.gold_balance,
        count_delta=None,
        duration=None,
        title_snapshot=task.title,
    )

    _save_task_profile_log(
        task=task,
        profile=profile,
        log=log,
        task_fields=[
            "claim_count",
            "is_claimed",
            "claimed_at",
            "last_action_at",
            "total_actions_count",
        ],
    )
    return task


@transaction.atomic
def log_activity_duration(
    *,
    profile: Profile,
    user,
    duration,
    title: str,
    timestamp: datetime | None = None,
    task: Task | None = None,
    reward: Task | None = None,
) -> LogEntry:
    """Append an activity duration log atomically for a profile-owned session."""
    ts = _as_aware_timestamp(timestamp)
    locked_profile = Profile.objects.select_for_update().get(id=profile.id)
    if locked_profile.account_id != user.id:
        raise ValidationError({"profile_id": "Profile does not belong to the authenticated user."})
    if duration is None or duration.total_seconds() <= 0:
        raise ValidationError({"duration": "Duration must be greater than zero."})
    if not title or not title.strip():
        raise ValidationError({"title": "Title is required."})

    locked_task = None
    if task is not None:
        locked_task = Task.objects.select_for_update().get(id=task.id)
        if locked_task.profile_id != locked_profile.id:
            raise ValidationError({"task_id": "Task must belong to the selected profile."})

    locked_reward = None
    if reward is not None:
        locked_reward = Task.objects.select_for_update().get(id=reward.id)
        if locked_reward.profile_id != locked_profile.id:
            raise ValidationError({"reward_id": "Reward must belong to the selected profile."})
        if locked_reward.task_type != Task.TaskType.REWARD:
            raise ValidationError({"reward_id": "Reward id must point to a reward task."})

    log = LogEntry(
        profile=locked_profile,
        timestamp=ts,
        type=LogEntry.LogType.ACTIVITY_DURATION,
        task=locked_task,
        reward=locked_reward,
        gold_delta=Decimal("0"),
        user_gold=_to_cents(locked_profile.gold_balance),
        count_delta=None,
        duration=duration,
        title_snapshot=title.strip(),
    )
    log.full_clean()
    log.save()
    return log
