from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone

from core.models import LogEntry, Profile, StreakBonusRule, Task
from core.services.task_actions import (
    daily_complete,
    get_uncompleted_dailies_from_previous_period,
    habit_increment,
    log_activity_duration,
    refresh_profile_period_state,
    reward_claim,
    start_new_day,
    todo_complete,
)


User = get_user_model()


class TestTaskActionsService(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="alice", password="pass1234")
        self.other_user = User.objects.create_user(username="bob", password="pass1234")
        self.profile = Profile.objects.create(
            account=self.user,
            name="Alice Main",
            gold_balance=Decimal("10.00"),
        )
        self.other_profile = Profile.objects.create(
            account=self.other_user,
            name="Bob Main",
            gold_balance=Decimal("7.00"),
        )

    def _latest_log_for(self, profile: Profile) -> LogEntry:
        return LogEntry.objects.filter(profile=profile).latest("created_at")

    def test_habit_increment_updates_task_and_creates_log(self):
        task = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.HABIT,
            title="Drink water",
            count_increment=Decimal("1.50"),
            gold_delta=Decimal("2.00"),
        )

        updated = habit_increment(
            task=task,
            profile=self.profile,
            user=self.user,
            by=Decimal("2.00"),
            timestamp=timezone.now(),
        )
        updated.refresh_from_db()
        self.profile.refresh_from_db()
        log = self._latest_log_for(self.profile)

        self.assertEqual(updated.current_count, Decimal("2.00"))
        self.assertEqual(updated.total_actions_count, 1)
        self.assertEqual(log.type, LogEntry.LogType.HABIT_INCREMENTED)
        self.assertEqual(log.count_delta, Decimal("2.00"))
        self.assertEqual(self.profile.gold_balance, Decimal("12.00"))
        self.assertEqual(self.profile.gold_balance, log.user_gold)

    def test_habit_increment_rejects_wrong_task_type(self):
        daily = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.DAILY,
            title="Daily",
            repeat_cadence=Task.Cadence.DAY,
            gold_delta=Decimal("1.00"),
        )
        with self.assertRaises(ValidationError):
            habit_increment(
                task=daily,
                profile=self.profile,
                user=self.user,
                by=None,
                timestamp=timezone.now(),
            )

    def test_daily_complete_applies_max_eligible_bonus_percent(self):
        task = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.DAILY,
            title="Meditate",
            repeat_cadence=Task.Cadence.DAY,
            gold_delta=Decimal("10.00"),
            current_streak=2,
            best_streak=2,
            last_completion_period=date(2026, 2, 20),
        )
        StreakBonusRule.objects.create(task=task, streak_goal=2, bonus_percent=Decimal("10"))
        StreakBonusRule.objects.create(task=task, streak_goal=3, bonus_percent=Decimal("25"))

        updated = daily_complete(
            task=task,
            profile=self.profile,
            user=self.user,
            timestamp=timezone.now(),
            completion_period=date(2026, 2, 21),
        )
        updated.refresh_from_db()
        self.profile.refresh_from_db()
        log = self._latest_log_for(self.profile)

        # base 10.00 with 25% bonus => 12.50
        self.assertEqual(log.gold_delta, Decimal("12.50"))
        self.assertEqual(updated.current_streak, 3)
        self.assertEqual(updated.best_streak, 3)
        self.assertEqual(self.profile.gold_balance, Decimal("22.50"))
        self.assertEqual(self.profile.gold_balance, log.user_gold)

    def test_daily_complete_rejects_second_completion_in_same_period(self):
        task = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.DAILY,
            title="Read",
            repeat_cadence=Task.Cadence.DAY,
            gold_delta=Decimal("2.00"),
        )
        ts = timezone.now()
        daily_complete(
            task=task,
            profile=self.profile,
            user=self.user,
            timestamp=ts,
            completion_period=ts.date(),
        )

        with self.assertRaises(ValidationError):
            daily_complete(
                task=task,
                profile=self.profile,
                user=self.user,
                timestamp=ts + timedelta(minutes=10),
                completion_period=ts.date(),
            )

    def test_daily_complete_uses_cadence_period_not_calendar_day(self):
        task = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.DAILY,
            title="Weekly daily",
            repeat_cadence=Task.Cadence.WEEK,
            repeat_every=1,
            gold_delta=Decimal("2.00"),
        )
        Task.objects.filter(id=task.id).update(created_at=timezone.make_aware(timezone.datetime(2026, 2, 16, 9, 0, 0)))
        task.refresh_from_db()
        daily_complete(
            task=task,
            profile=self.profile,
            user=self.user,
            timestamp=timezone.make_aware(timezone.datetime(2026, 2, 17, 9, 0, 0)),
        )
        with self.assertRaises(ValidationError):
            daily_complete(
                task=task,
                profile=self.profile,
                user=self.user,
                timestamp=timezone.make_aware(timezone.datetime(2026, 2, 18, 9, 0, 0)),
            )

    def test_refresh_profile_period_state_resets_habit_count_on_new_period(self):
        habit = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.HABIT,
            title="Habit",
            current_count=Decimal("4.00"),
            count_increment=Decimal("1.00"),
            count_reset_cadence=Task.Cadence.DAY,
            last_action_at=timezone.make_aware(timezone.datetime(2026, 2, 20, 12, 0, 0)),
        )
        refresh_profile_period_state(
            profile=self.profile,
            user=self.user,
            timestamp=timezone.make_aware(timezone.datetime(2026, 2, 21, 8, 0, 0)),
        )
        habit.refresh_from_db()
        self.assertEqual(habit.current_count, Decimal("0.00"))

    def test_new_day_preview_and_start_can_backfill_previous_period_daily(self):
        daily = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.DAILY,
            title="Streak daily",
            repeat_cadence=Task.Cadence.DAY,
            repeat_every=1,
            gold_delta=Decimal("1.00"),
            current_streak=3,
            best_streak=3,
            last_completion_period=date(2026, 2, 19),
        )
        Task.objects.filter(id=daily.id).update(created_at=timezone.make_aware(timezone.datetime(2026, 2, 1, 8, 0, 0)))
        daily.refresh_from_db()
        preview = get_uncompleted_dailies_from_previous_period(
            profile=self.profile,
            user=self.user,
            timestamp=timezone.make_aware(timezone.datetime(2026, 2, 21, 8, 0, 0)),
        )
        self.assertEqual(len(preview), 1)
        self.assertEqual(preview[0]["id"], str(daily.id))
        self.assertEqual(preview[0]["previous_period_start"], "2026-02-20")

        result = start_new_day(
            profile=self.profile,
            user=self.user,
            checked_daily_ids=[daily.id],
            timestamp=timezone.make_aware(timezone.datetime(2026, 2, 21, 8, 0, 0)),
        )
        self.assertEqual(result["updated_count"], 1)
        daily.refresh_from_db()
        self.assertEqual(daily.last_completion_period, date(2026, 2, 20))
        self.assertEqual(daily.current_streak, 4)

    def test_new_day_preview_skips_task_already_completed_for_current_period(self):
        daily = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.DAILY,
            title="Already done current",
            repeat_cadence=Task.Cadence.DAY,
            repeat_every=1,
            gold_delta=Decimal("1.00"),
            current_streak=2,
            best_streak=2,
            last_completion_period=date(2026, 2, 21),
        )
        preview = get_uncompleted_dailies_from_previous_period(
            profile=self.profile,
            user=self.user,
            timestamp=timezone.make_aware(timezone.datetime(2026, 2, 21, 12, 0, 0)),
        )
        self.assertEqual(preview, [])

        result = start_new_day(
            profile=self.profile,
            user=self.user,
            checked_daily_ids=[daily.id],
            timestamp=timezone.make_aware(timezone.datetime(2026, 2, 21, 12, 0, 0)),
        )
        self.assertEqual(result["updated_count"], 0)
        daily.refresh_from_db()
        self.assertEqual(daily.last_completion_period, date(2026, 2, 21))

    def test_todo_complete_marks_done_once_and_logs_balance_consistency(self):
        task = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.TODO,
            title="Inbox zero",
            gold_delta=Decimal("3.00"),
        )

        updated = todo_complete(
            task=task,
            profile=self.profile,
            user=self.user,
            timestamp=timezone.now(),
        )
        updated.refresh_from_db()
        self.profile.refresh_from_db()
        log = self._latest_log_for(self.profile)

        self.assertTrue(updated.is_done)
        self.assertIsNotNone(updated.completed_at)
        self.assertEqual(log.type, LogEntry.LogType.TODO_COMPLETED)
        self.assertEqual(self.profile.gold_balance, Decimal("13.00"))
        self.assertEqual(self.profile.gold_balance, log.user_gold)

        with self.assertRaises(ValidationError):
            todo_complete(
                task=task,
                profile=self.profile,
                user=self.user,
                timestamp=timezone.now(),
            )

    def test_reward_claim_rejects_insufficient_funds(self):
        reward = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.REWARD,
            title="Expensive reward",
            gold_delta=Decimal("-99.00"),
            is_repeatable=False,
        )
        with self.assertRaises(ValidationError):
            reward_claim(
                task=reward,
                profile=self.profile,
                user=self.user,
                timestamp=timezone.now(),
            )

    def test_reward_claim_non_repeatable_rejects_second_claim(self):
        reward = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.REWARD,
            title="Coffee",
            gold_delta=Decimal("-3.00"),
            is_repeatable=False,
        )
        reward_claim(
            task=reward,
            profile=self.profile,
            user=self.user,
            timestamp=timezone.now(),
        )
        with self.assertRaises(ValidationError):
            reward_claim(
                task=reward,
                profile=self.profile,
                user=self.user,
                timestamp=timezone.now(),
            )

    def test_reward_claim_success_sets_reward_fk_and_balance_matches_log(self):
        reward = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.REWARD,
            title="Snack",
            gold_delta=Decimal("-4.00"),
            is_repeatable=True,
        )

        updated = reward_claim(
            task=reward,
            profile=self.profile,
            user=self.user,
            timestamp=timezone.now(),
        )
        updated.refresh_from_db()
        self.profile.refresh_from_db()
        log = self._latest_log_for(self.profile)

        self.assertTrue(updated.is_claimed)
        self.assertEqual(updated.claim_count, 1)
        self.assertEqual(log.type, LogEntry.LogType.REWARD_CLAIMED)
        self.assertEqual(log.reward_id, reward.id)
        self.assertEqual(self.profile.gold_balance, Decimal("6.00"))
        self.assertEqual(self.profile.gold_balance, log.user_gold)

    def test_action_rejects_wrong_profile_owner(self):
        task = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.HABIT,
            title="Walk",
            gold_delta=Decimal("1.00"),
        )
        with self.assertRaises(ValidationError):
            habit_increment(
                task=task,
                profile=self.profile,
                user=self.other_user,
                by=None,
                timestamp=timezone.now(),
            )

    def test_log_activity_duration_success(self):
        task = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.TODO,
            title="Focus",
            gold_delta=Decimal("1.00"),
        )
        reward = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.REWARD,
            title="Break",
            gold_delta=Decimal("-1.00"),
            is_repeatable=True,
        )
        duration = timedelta(minutes=20)

        log = log_activity_duration(
            profile=self.profile,
            user=self.user,
            duration=duration,
            title="Deep work",
            timestamp=timezone.now(),
            task=task,
            reward=reward,
        )
        self.profile.refresh_from_db()

        self.assertEqual(log.type, LogEntry.LogType.ACTIVITY_DURATION)
        self.assertEqual(log.duration, duration)
        self.assertEqual(log.task_id, task.id)
        self.assertEqual(log.reward_id, reward.id)
        self.assertEqual(log.user_gold, self.profile.gold_balance)

    def test_log_activity_duration_rejects_non_owner(self):
        with self.assertRaises(ValidationError):
            log_activity_duration(
                profile=self.profile,
                user=self.other_user,
                duration=timedelta(minutes=5),
                title="Invalid",
                timestamp=timezone.now(),
            )
