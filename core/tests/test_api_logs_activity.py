from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import LogEntry, Profile, Task


User = get_user_model()


class TestApiLogsAndActivityDuration(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="alice", password="pass1234")
        self.other_user = User.objects.create_user(username="bob", password="pass1234")

        self.profile = Profile.objects.create(account=self.user, name="Alice Main", gold_balance=Decimal("12.00"))
        self.other_profile = Profile.objects.create(account=self.other_user, name="Bob Main")
        self.task = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.TODO,
            title="Task",
            gold_delta=Decimal("2.00"),
        )
        self.reward = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.REWARD,
            title="Reward",
            gold_delta=Decimal("-3.00"),
            is_repeatable=True,
        )

    def test_logs_list_requires_profile_id(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("log-list"))
        self.assertEqual(response.status_code, 400)
        self.assertIn("profile_id", response.data)

    def test_logs_list_wrong_profile_returns_404(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("log-list"), {"profile_id": str(self.other_profile.id)})
        self.assertEqual(response.status_code, 404)

    def test_logs_filtering_by_type_date_and_limit(self):
        self.client.force_authenticate(user=self.user)
        now = timezone.now()
        for idx in range(3):
            LogEntry.objects.create(
                profile=self.profile,
                timestamp=now - timedelta(days=idx),
                type=LogEntry.LogType.TODO_COMPLETED,
                task=self.task,
                gold_delta=Decimal("1.00"),
                user_gold=Decimal("12.00"),
                title_snapshot=f"todo-{idx}",
            )
        LogEntry.objects.create(
            profile=self.profile,
            timestamp=now,
            type=LogEntry.LogType.ACTIVITY_DURATION,
            task=self.task,
            gold_delta=Decimal("0.00"),
            user_gold=Decimal("12.00"),
            duration=timedelta(minutes=15),
            title_snapshot="activity",
        )

        response = self.client.get(
            reverse("log-list"),
            {
                "profile_id": str(self.profile.id),
                "type": LogEntry.LogType.TODO_COMPLETED,
                "from": (now - timedelta(days=2)).date().isoformat(),
                "to": now.date().isoformat(),
                "limit": "2",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 2)
        for item in response.data:
            self.assertEqual(item["type"], LogEntry.LogType.TODO_COMPLETED)

    def test_logs_limit_validation(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("log-list"), {"profile_id": str(self.profile.id), "limit": "abc"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("limit", response.data)

    def test_activity_duration_create_success(self):
        self.client.force_authenticate(user=self.user)
        payload = {
            "profile_id": str(self.profile.id),
            "duration": "00:25:00",
            "title": "Deep Work",
            "task_id": str(self.task.id),
            "reward_id": str(self.reward.id),
            "timestamp": timezone.now().isoformat(),
        }
        response = self.client.post(reverse("activity-duration-list"), payload, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["type"], LogEntry.LogType.ACTIVITY_DURATION)
        self.assertEqual(str(response.data["task_id"]), str(self.task.id))
        self.assertEqual(str(response.data["reward_id"]), str(self.reward.id))
        self.assertEqual(response.data["user_gold"], "12.00")

    def test_activity_duration_rejects_other_users_profile(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            reverse("activity-duration-list"),
            {
                "profile_id": str(self.other_profile.id),
                "duration": "00:05:00",
                "title": "Bad",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_activity_duration_requires_clear_validation_fields(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            reverse("activity-duration-list"),
            {
                "profile_id": str(self.profile.id),
                "duration": "00:00:00",
                "title": "Deep Work",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("duration", response.data)
