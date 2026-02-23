from decimal import Decimal
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import ChecklistItem, Profile, StreakBonusRule, Tag, Task


User = get_user_model()


class TestApiScoping(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="alice", password="pass1234")
        self.other_user = User.objects.create_user(username="bob", password="pass1234")

        self.profile = Profile.objects.create(account=self.user, name="Alice Main")
        self.other_profile = Profile.objects.create(account=self.other_user, name="Bob Main")

        self.todo = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.TODO,
            title="Inbox zero",
            gold_delta=Decimal("2.00"),
        )
        self.daily = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.DAILY,
            title="Daily read",
            repeat_cadence=Task.Cadence.DAY,
            gold_delta=Decimal("2.00"),
        )
        self.habit = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.HABIT,
            title="Water",
            gold_delta=Decimal("1.00"),
        )
        self.tag = Tag.objects.create(profile=self.profile, name="Health")
        self.todo.tags.add(self.tag)
        self.checklist = ChecklistItem.objects.create(task=self.todo, text="Empty inbox", sort_order=1)
        self.rule = StreakBonusRule.objects.create(task=self.daily, streak_goal=2, bonus_percent=Decimal("20.00"))

    def test_unauthenticated_endpoints_are_blocked(self):
        urls = [
            reverse("task-list"),
            reverse("profile-list"),
            reverse("tag-list"),
            reverse("checklist-item-list"),
            reverse("streak-bonus-rule-list"),
            reverse("log-list"),
            reverse("activity-duration-list"),
            reverse("new-day-list"),
        ]
        for url in urls:
            response = self.client.get(url)
            self.assertIn(response.status_code, [401, 403], msg=url)

    def test_task_list_requires_profile_id(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("task-list"))
        self.assertEqual(response.status_code, 400)
        self.assertIn("profile_id", response.data)

    def test_task_retrieve_requires_profile_id(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("task-detail", kwargs={"pk": self.todo.id}))
        self.assertEqual(response.status_code, 400)
        self.assertIn("profile_id", response.data)

    def test_task_list_wrong_profile_returns_404(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(
            reverse("task-list"),
            {"profile_id": str(self.other_profile.id)},
        )
        self.assertEqual(response.status_code, 404)

    def test_task_retrieve_wrong_profile_returns_404(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(
            reverse("task-detail", kwargs={"pk": self.todo.id}),
            {"profile_id": str(self.other_profile.id)},
        )
        self.assertEqual(response.status_code, 404)

    def test_profiles_are_scoped_to_authenticated_account(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("profile-list"))
        self.assertEqual(response.status_code, 200)
        ids = {item["id"] for item in response.data}
        self.assertIn(str(self.profile.id), ids)
        self.assertNotIn(str(self.other_profile.id), ids)

    def test_tags_list_requires_valid_profile_id_for_non_empty(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("tag-list"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, [])

        response = self.client.get(reverse("tag-list"), {"profile_id": str(self.profile.id)})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["id"], str(self.tag.id))

    def test_tag_create_enforces_profile_ownership(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            reverse("tag-list"),
            {"profile": str(self.other_profile.id), "name": "Bad"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_checklist_item_create_rejects_non_todo_task(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            reverse("checklist-item-list"),
            {"task": str(self.habit.id), "text": "bad", "sort_order": 0},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("task", response.data)

    def test_streak_rule_create_rejects_non_daily_task(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            reverse("streak-bonus-rule-list"),
            {"task": str(self.todo.id), "streak_goal": 1, "bonus_percent": "10.00"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("task", response.data)

    def test_new_day_preview_and_start_are_profile_scoped(self):
        self.client.force_authenticate(user=self.user)
        yesterday = timezone.localdate() - timezone.timedelta(days=1)
        Task.objects.filter(id=self.daily.id).update(last_completion_period=yesterday - timezone.timedelta(days=1))

        preview = self.client.get(reverse("new-day-list"), {"profile_id": str(self.profile.id)})
        self.assertEqual(preview.status_code, 200)
        self.assertIn("dailies", preview.data)

        wrong = self.client.get(reverse("new-day-list"), {"profile_id": str(self.other_profile.id)})
        self.assertEqual(wrong.status_code, 404)

        start = self.client.post(
            reverse("new-day-list"),
            {"profile_id": str(self.profile.id), "checked_daily_ids": [str(self.daily.id)]},
            format="json",
        )
        self.assertEqual(start.status_code, 200)
        self.assertIn("updated_count", start.data)

    def test_new_day_does_not_backfill_when_current_period_already_completed(self):
        self.client.force_authenticate(user=self.user)
        today = timezone.localdate()
        Task.objects.filter(id=self.daily.id).update(last_completion_period=today)

        preview = self.client.get(reverse("new-day-list"), {"profile_id": str(self.profile.id)})
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.data["dailies"], [])

        start = self.client.post(
            reverse("new-day-list"),
            {"profile_id": str(self.profile.id), "checked_daily_ids": [str(self.daily.id)]},
            format="json",
        )
        self.assertEqual(start.status_code, 200)
        self.assertEqual(start.data["updated_count"], 0)

        self.daily.refresh_from_db()
        self.assertEqual(self.daily.last_completion_period, today)

    def test_new_day_preview_skips_daily_created_in_current_period(self):
        self.client.force_authenticate(user=self.user)
        today = timezone.localdate()
        Task.objects.filter(id=self.daily.id).update(created_at=timezone.make_aware(timezone.datetime(today.year, today.month, today.day, 10, 0, 0)))

        preview = self.client.get(reverse("new-day-list"), {"profile_id": str(self.profile.id)})
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.data["dailies"], [])
