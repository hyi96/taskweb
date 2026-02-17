from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from core.models import LogEntry, Profile, Task

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

    period = completion_period or timestamp.date()
    if task.last_completion_period == period:
        raise ValidationError({"completion_period": "Task is already completed for this period."})

    task.last_completion_period = period
    task.current_streak += 1
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
