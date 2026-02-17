from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import LogEntry, Profile, Task


User = get_user_model()


class TaskActionApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="alice", password="pass1234")
        self.other_user = User.objects.create_user(username="bob", password="pass1234")

        self.profile = Profile.objects.create(account=self.user, name="Alice Main", gold_balance=Decimal("10.00"))
        self.other_profile = Profile.objects.create(
            account=self.other_user, name="Bob Main", gold_balance=Decimal("10.00")
        )
        self.client.force_authenticate(user=self.user)

    def test_cannot_complete_someone_else_task(self):
        other_todo = Task.objects.create(
            profile=self.other_profile,
            task_type=Task.TaskType.TODO,
            title="Other user task",
            gold_delta=Decimal("2.00"),
        )
        url = reverse("task-todo-complete", kwargs={"pk": other_todo.id})
        response = self.client.post(url, {"profile_id": str(self.other_profile.id)}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_daily_cannot_be_completed_twice_in_same_period(self):
        daily = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.DAILY,
            title="Daily",
            repeat_cadence=Task.Cadence.DAY,
            gold_delta=Decimal("5.00"),
        )
        url = reverse("task-daily-complete", kwargs={"pk": daily.id})
        payload = {"profile_id": str(self.profile.id), "completion_period": "2026-02-17"}

        first = self.client.post(url, payload, format="json")
        second = self.client.post(url, payload, format="json")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 400)
        self.assertIn("completion_period", second.data)
        self.profile.refresh_from_db()
        log = LogEntry.objects.latest("created_at")
        self.assertEqual(log.type, LogEntry.LogType.DAILY_COMPLETED)
        self.assertEqual(self.profile.gold_balance, log.user_gold)

    def test_reward_claim_fails_on_insufficient_funds(self):
        reward = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.REWARD,
            title="Big Reward",
            gold_delta=Decimal("-50.00"),
            is_repeatable=False,
        )
        url = reverse("task-reward-claim", kwargs={"pk": reward.id})
        response = self.client.post(url, {"profile_id": str(self.profile.id)}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("gold_balance", response.data)

    def test_reward_claim_creates_log_and_balance_matches(self):
        reward = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.REWARD,
            title="Small Reward",
            gold_delta=Decimal("-3.00"),
            is_repeatable=False,
        )
        url = reverse("task-reward-claim", kwargs={"pk": reward.id})
        response = self.client.post(url, {"profile_id": str(self.profile.id)}, format="json")
        self.assertEqual(response.status_code, 200)

        reward.refresh_from_db()
        self.profile.refresh_from_db()
        log = LogEntry.objects.latest("created_at")
        self.assertEqual(log.type, LogEntry.LogType.REWARD_CLAIMED)
        self.assertEqual(log.reward_id, reward.id)
        self.assertEqual(self.profile.gold_balance, log.user_gold)

    def test_habit_increment_updates_count_and_log(self):
        habit = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.HABIT,
            title="Drink water",
            count_increment=Decimal("1.50"),
            gold_delta=Decimal("3.00"),
        )
        url = reverse("task-habit-increment", kwargs={"pk": habit.id})
        timestamp = timezone.now().isoformat()
        response = self.client.post(
            url,
            {"profile_id": str(self.profile.id), "timestamp": timestamp, "by": "2.00"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        habit.refresh_from_db()
        self.profile.refresh_from_db()
        log = LogEntry.objects.latest("created_at")
        self.assertEqual(habit.current_count, Decimal("2.00"))
        self.assertEqual(log.type, LogEntry.LogType.HABIT_INCREMENTED)
        self.assertEqual(log.count_delta, Decimal("2.00"))
        self.assertEqual(self.profile.gold_balance, log.user_gold)

    def test_todo_complete_creates_log_and_balance_matches(self):
        todo = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.TODO,
            title="Inbox Zero",
            gold_delta=Decimal("4.00"),
        )
        url = reverse("task-todo-complete", kwargs={"pk": todo.id})
        response = self.client.post(url, {"profile_id": str(self.profile.id)}, format="json")
        self.assertEqual(response.status_code, 200)

        todo.refresh_from_db()
        self.profile.refresh_from_db()
        log = LogEntry.objects.latest("created_at")
        self.assertTrue(todo.is_done)
        self.assertEqual(log.type, LogEntry.LogType.TODO_COMPLETED)
        self.assertEqual(self.profile.gold_balance, log.user_gold)
