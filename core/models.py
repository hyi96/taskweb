# models.py
import uuid
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import Q


# ----------------------------
# Core ownership: Account -> Profile (desktop-like "switchable users")
# ----------------------------
class Profile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profiles",
    )
    name = models.CharField(max_length=80)
    created_at = models.DateTimeField(auto_now_add=True)

    # cached balance (logs can remain the audit trail)
    gold_balance = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["account", "name"],
                name="uniq_profile_name_per_account",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name}"


# ----------------------------
# Tags (owned per profile)
# ----------------------------
class Tag(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="tags")
    name = models.CharField(max_length=60)
    created_at = models.DateTimeField(auto_now_add=True)

    # Optional: system tags created internally (user cannot rename/delete in UI)
    is_system = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["profile", "name"],
                name="uniq_tag_name_per_profile",
            ),
        ]
        indexes = [
            models.Index(fields=["profile", "name"]),
        ]

    def __str__(self) -> str:
        return self.name


# ----------------------------
# Task (single-table "union" of Habit / Daily / Todo / Reward)
# ----------------------------
class Task(models.Model):
    class TaskType(models.TextChoices):
        HABIT = "habit", "Habit"
        DAILY = "daily", "Daily"
        TODO = "todo", "Todo"
        REWARD = "reward", "Reward"

    class Cadence(models.TextChoices):
        # "never" is useful for fields where cadence is optional or not applicable
        NEVER = "never", "Never"
        DAY = "day", "Daily"
        WEEK = "week", "Weekly"
        MONTH = "month", "Monthly"
        YEAR = "year", "Yearly"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # ownership
    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="tasks")

    # shared (DomainEntity-like)
    task_type = models.CharField(max_length=10, choices=TaskType.choices)
    title = models.CharField(max_length=200)
    notes = models.TextField(blank=True)
    is_hidden = models.BooleanField(default=False)
    tags = models.ManyToManyField(Tag, blank=True, related_name="tasks")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    last_action_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Last time the primary action happened (habit increment, daily complete, todo done, reward claim).",
    )
    total_actions_count = models.PositiveIntegerField(default=0)

    # + earn, - spend (rewards)
    gold_delta = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    # --- Habit fields ---
    current_count = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    count_increment = models.DecimalField(max_digits=12, decimal_places=2, default=1)
    count_reset_cadence = models.CharField(
        max_length=10,
        choices=Cadence.choices,
        null=True,
        blank=True,
        help_text="If set, habit counter can reset by cadence. 'never'/null means never resets.",
    )

    # --- Daily fields ---
    # cadence is only Daily/Weekly/Monthly/Yearly (no Never)
    repeat_cadence = models.CharField(
        max_length=10,
        choices=Cadence.choices,
        null=True,
        blank=True,
        help_text="Daily scheduling cadence. For Daily tasks, must be day/week/month/year (not never).",
    )
    repeat_every = models.PositiveIntegerField(
        default=1,
        validators=[MinValueValidator(1)],
        help_text="Every N cadences (e.g. every 3 days, every 2 weeks).",
    )

    current_streak = models.PositiveIntegerField(default=0)
    best_streak = models.PositiveIntegerField(default=0)
    streak_goal = models.PositiveIntegerField(default=0)

    # Rough equivalent to DateOnly? _lastCompletionPeriod
    # (store a date bucket; exact bucketing logic lives in service layer)
    last_completion_period = models.DateField(null=True, blank=True)
    autocomplete_time_threshold = models.DurationField(null=True, blank=True)

    # --- Todo fields ---
    due_at = models.DateTimeField(null=True, blank=True)
    is_done = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)

    # --- Reward fields ---
    is_repeatable = models.BooleanField(default=False)
    is_claimed = models.BooleanField(default=False)
    claimed_at = models.DateTimeField(null=True, blank=True)
    claim_count = models.PositiveIntegerField(default=0)
    

    class Meta:
        indexes = [
            models.Index(fields=["profile", "task_type", "is_hidden"]),
            models.Index(fields=["profile", "due_at"]),
            models.Index(fields=["profile", "last_action_at"]),
            models.Index(fields=["profile", "created_at"]),
        ]
        constraints = [
            # --- Todo invariants ---
            models.CheckConstraint(
                name="task_only_todo_can_be_done",
                condition=Q(task_type="todo") | Q(is_done=False),
            ),
            models.CheckConstraint(
                name="task_only_todo_can_have_completed_at",
                condition=Q(task_type="todo") | Q(completed_at__isnull=True),
            ),
            models.CheckConstraint(
                name="task_todo_done_requires_completed_at",
                condition=(Q(is_done=False) & Q(completed_at__isnull=True))
                | (Q(is_done=True) & Q(completed_at__isnull=False)),
            ),

            # --- Reward cost rule ---
            # If you want to allow free rewards, change lt -> lte
            models.CheckConstraint(
                name="task_reward_gold_delta_negative",
                condition=Q(task_type="reward", gold_delta__lt=0)
                | ~Q(task_type="reward"),
            ),

            # --- Reward-only fields defaulted for non-reward tasks ---
            models.CheckConstraint(
                name="task_non_reward_has_default_reward_fields",
                condition=Q(task_type="reward")
                | (
                    Q(is_repeatable=False)
                    & Q(is_claimed=False)
                    & Q(claim_count=0)
                    & Q(claimed_at__isnull=True)
                ),
            ),
            models.CheckConstraint(
                name="task_reward_claimed_requires_claimed_at",
                condition=~Q(task_type="reward")
                | Q(is_claimed=False)
                | Q(claimed_at__isnull=False),
            ),

            # --- Daily-only scheduling/streak fields ---
            # For Daily: repeat_cadence must NOT be never/null
            models.CheckConstraint(
                name="task_daily_requires_repeat_cadence",
                condition=~Q(task_type="daily")
                | (
                    Q(repeat_cadence__in=["day", "week", "month", "year"])
                    & Q(repeat_every__gte=1)
                ),
            ),
            # For non-daily tasks: keep daily-specific fields at defaults
            models.CheckConstraint(
                name="task_non_daily_has_default_daily_fields",
                condition=Q(task_type="daily")
                | (
                    Q(repeat_cadence__isnull=True)
                    & Q(current_streak=0)
                    & Q(best_streak=0)
                    & Q(streak_goal=0)
                    & Q(last_completion_period__isnull=True)
                    & Q(autocomplete_time_threshold__isnull=True)
                ),
            ),

            # --- Habit-only count fields (optional strictness) ---
            models.CheckConstraint(
                name="task_non_habit_has_default_habit_fields",
                condition=Q(task_type="habit")
                | (
                    Q(current_count=0)
                    & Q(count_increment=1)
                    & Q(count_reset_cadence__isnull=True)
                ),
            ),
        ]

    def __str__(self) -> str:
        return f"[{self.task_type}] {self.title}"


# ----------------------------
# Todo checklist items (your ChecklistItem)
# ----------------------------
class ChecklistItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="checklist_items")
    text = models.CharField(max_length=300)
    is_completed = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["task", "sort_order"]),
        ]

    def __str__(self) -> str:
        return self.text

    def clean(self) -> None:
        if self.task_id and self.task.task_type != Task.TaskType.TODO:
            raise ValidationError({"task": "Checklist items can only be attached to TODO tasks."})


# ----------------------------
# Daily streak bonus rules (your StreakBonusRule list)
# ----------------------------
class StreakBonusRule(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="streak_bonus_rules")
    streak_goal = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    bonus_percent = models.DecimalField(max_digits=6, decimal_places=2, validators=[MinValueValidator(0)])
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["task", "streak_goal"],
                name="uniq_bonus_rule_per_task_goal",
            ),
        ]
        indexes = [
            models.Index(fields=["task", "streak_goal"]),
        ]

    def __str__(self) -> str:
        return f"streak≥{self.streak_goal} => +{self.bonus_percent}%"

    def clean(self) -> None:
        if self.task_id and self.task.task_type != Task.TaskType.DAILY:
            raise ValidationError({"task": "Streak bonus rules can only be attached to DAILY tasks."})


# ----------------------------
# Logs (your LogEntry + LogType)
# ----------------------------
class LogEntry(models.Model):
    class LogType(models.TextChoices):
        DAILY_COMPLETED = "daily_completed", "DailyCompleted"
        HABIT_INCREMENTED = "habit_incremented", "HabitIncremented"
        TODO_COMPLETED = "todo_completed", "TodoCompleted"
        REWARD_CLAIMED = "reward_claimed", "RewardClaimed"
        ACTIVITY_DURATION = "activity_duration", "ActivityDuration"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="logs")
    timestamp = models.DateTimeField(help_text="When the event occurred (can be backfilled/imported).")
    created_at = models.DateTimeField(auto_now_add=True)

    type = models.CharField(max_length=32, choices=LogType.choices)

    task = models.ForeignKey(Task, null=True, blank=True, on_delete=models.SET_NULL, related_name="logs")
    # If you later split Reward into its own table, keep reward FK; for now Task(REWARD) is enough
    reward = models.ForeignKey(
        Task,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reward_logs",
        limit_choices_to=Q(task_type=Task.TaskType.REWARD),
    )

    gold_delta = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    user_gold = models.DecimalField(max_digits=12, decimal_places=2, default=0)  # balance AFTER delta

    count_delta = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    duration = models.DurationField(null=True, blank=True)

    title_snapshot = models.CharField(max_length=200, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["profile", "-timestamp"]),
            models.Index(fields=["profile", "type", "-timestamp"]),
            models.Index(fields=["profile", "task", "-timestamp"]),
            models.Index(fields=["profile", "reward", "-timestamp"]),
        ]

    def __str__(self) -> str:
        return f"{self.timestamp} {self.type} {self.title_snapshot}".strip()

    def clean(self) -> None:
        errors = {}
        if self.task_id and self.task.profile_id != self.profile_id:
            errors["task"] = "Task must belong to the same profile as the log entry."
        if self.reward_id:
            if self.reward.profile_id != self.profile_id:
                errors["reward"] = "Reward must belong to the same profile as the log entry."
            elif self.reward.task_type != Task.TaskType.REWARD:
                errors["reward"] = "Reward must point to a task of type REWARD."
        if errors:
            raise ValidationError(errors)


class InspirationalPhrase(models.Model):
    """Site-wide phrase bank used for deterministic phrase-of-the-day selection."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    text = models.CharField(max_length=220, unique=True)
    author = models.CharField(max_length=120, default="Unknown")
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "created_at", "id"]
        indexes = [
            models.Index(fields=["is_active", "sort_order", "created_at"]),
        ]

    def __str__(self) -> str:
        return self.text
