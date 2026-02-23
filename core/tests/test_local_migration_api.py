from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from core.models import ChecklistItem, LogEntry, Profile, StreakBonusRule, Tag, Task


User = get_user_model()


class TestLocalMigrationApi(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="alice", password="pass1234")
        self.other_user = User.objects.create_user(username="bob", password="pass1234")
        self.profile = Profile.objects.create(account=self.user, name="Cloud")
        self.other_profile = Profile.objects.create(account=self.other_user, name="Other")
        self.client.force_authenticate(user=self.user)

    def _payload(self):
        return {
            "format": "taskweb-indexeddb-v1",
            "exported_at": "2026-02-23T12:00:00Z",
            "profile": {
                "id": "11111111-1111-1111-1111-111111111111",
                "name": "Local",
                "gold_balance": "12.00",
                "created_at": "2026-02-20T09:00:00Z",
            },
            "tags": [
                {
                    "id": "22222222-2222-2222-2222-222222222222",
                    "profile_id": "11111111-1111-1111-1111-111111111111",
                    "name": "Health",
                    "is_system": False,
                }
            ],
            "tasks": [
                {
                    "id": "33333333-3333-3333-3333-333333333333",
                    "profile_id": "11111111-1111-1111-1111-111111111111",
                    "task_type": "todo",
                    "title": "Inbox zero",
                    "notes": "",
                    "is_hidden": False,
                    "tag_ids": ["22222222-2222-2222-2222-222222222222"],
                    "gold_delta": "2.00",
                    "current_count": "0.00",
                    "count_increment": "1.00",
                    "count_reset_cadence": None,
                    "repeat_cadence": None,
                    "repeat_every": 1,
                    "current_streak": 0,
                    "best_streak": 0,
                    "streak_goal": 0,
                    "last_completion_period": None,
                    "autocomplete_time_threshold": None,
                    "due_at": None,
                    "is_done": False,
                    "completed_at": None,
                    "is_repeatable": False,
                    "is_claimed": False,
                    "claimed_at": None,
                    "claim_count": 0,
                    "total_actions_count": 0,
                    "last_action_at": None,
                },
                {
                    "id": "44444444-4444-4444-4444-444444444444",
                    "profile_id": "11111111-1111-1111-1111-111111111111",
                    "task_type": "daily",
                    "title": "Daily read",
                    "notes": "",
                    "is_hidden": False,
                    "tag_ids": [],
                    "gold_delta": "1.00",
                    "current_count": "0.00",
                    "count_increment": "1.00",
                    "count_reset_cadence": None,
                    "repeat_cadence": "day",
                    "repeat_every": 1,
                    "current_streak": 1,
                    "best_streak": 2,
                    "streak_goal": 0,
                    "last_completion_period": "2026-02-22",
                    "autocomplete_time_threshold": None,
                    "due_at": None,
                    "is_done": False,
                    "completed_at": None,
                    "is_repeatable": False,
                    "is_claimed": False,
                    "claimed_at": None,
                    "claim_count": 0,
                    "total_actions_count": 2,
                    "last_action_at": "2026-02-22T09:00:00Z",
                },
            ],
            "checklist_items": [
                {
                    "id": "55555555-5555-5555-5555-555555555555",
                    "task_id": "33333333-3333-3333-3333-333333333333",
                    "text": "Archive mail",
                    "is_completed": False,
                    "sort_order": 0,
                }
            ],
            "streak_bonus_rules": [
                {
                    "id": "66666666-6666-6666-6666-666666666666",
                    "task_id": "44444444-4444-4444-4444-444444444444",
                    "streak_goal": 3,
                    "bonus_percent": "10.00",
                }
            ],
            "logs": [
                {
                    "id": "77777777-7777-7777-7777-777777777777",
                    "profile_id": "11111111-1111-1111-1111-111111111111",
                    "timestamp": "2026-02-22T09:00:00Z",
                    "type": 0,
                    "task_id": "44444444-4444-4444-4444-444444444444",
                    "reward_id": None,
                    "gold_delta": "1.00",
                    "user_gold": "12.00",
                    "count_delta": None,
                    "duration": None,
                    "title_snapshot": "Daily read",
                }
            ],
        }

    def test_profile_migrate_local_imports_entities(self):
        response = self.client.post(
            reverse("profile-migrate-local", kwargs={"pk": self.profile.id}),
            data=self._payload(),
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.gold_balance, Decimal("12.00"))
        self.assertEqual(Tag.objects.filter(profile=self.profile).count(), 1)
        self.assertEqual(Task.objects.filter(profile=self.profile).count(), 2)
        self.assertEqual(ChecklistItem.objects.filter(task__profile=self.profile).count(), 1)
        self.assertEqual(StreakBonusRule.objects.filter(task__profile=self.profile).count(), 1)
        self.assertEqual(LogEntry.objects.filter(profile=self.profile).count(), 1)

    def test_profile_migrate_local_is_profile_scoped(self):
        response = self.client.post(
            reverse("profile-migrate-local", kwargs={"pk": self.other_profile.id}),
            data=self._payload(),
            format="json",
        )
        self.assertEqual(response.status_code, 404)
