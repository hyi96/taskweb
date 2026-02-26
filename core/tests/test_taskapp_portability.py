import io
import json
import zipfile
from datetime import datetime, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from core.models import LogEntry, Profile, Task
from core.services.task_actions import get_uncompleted_dailies_from_previous_period
from core.services.taskapp_portability import TaskAppPortabilityService


class TaskAppPortabilityServiceTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="port", password="pass1234")
        self.profile = Profile.objects.create(account=self.user, name="Main", gold_balance=Decimal("42.50"))

    def test_export_then_import_round_trip(self):
        task = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.HABIT,
            title="Drink water",
            gold_delta=Decimal("1.25"),
            current_count=Decimal("5"),
            count_increment=Decimal("2"),
            last_action_at=timezone.now(),
            total_actions_count=4,
        )
        reward = Task.objects.create(
            profile=self.profile,
            task_type=Task.TaskType.REWARD,
            title="Coffee",
            gold_delta=Decimal("-3.00"),
            is_repeatable=True,
            claim_count=2,
            is_claimed=True,
            claimed_at=timezone.now(),
            last_action_at=timezone.now(),
            total_actions_count=2,
        )
        LogEntry.objects.create(
            profile=self.profile,
            timestamp=timezone.now(),
            type=LogEntry.LogType.HABIT_INCREMENTED,
            task=task,
            gold_delta=Decimal("1.25"),
            user_gold=Decimal("43.75"),
            count_delta=Decimal("2"),
            title_snapshot=task.title,
        )
        LogEntry.objects.create(
            profile=self.profile,
            timestamp=timezone.now(),
            type=LogEntry.LogType.ACTIVITY_DURATION,
            duration=timedelta(minutes=25),
            gold_delta=Decimal("0"),
            user_gold=Decimal("43.75"),
            title_snapshot="Deep Work",
        )

        archive_bytes, filename = TaskAppPortabilityService.export_profile_archive(profile=self.profile, user=self.user)
        self.assertTrue(filename.endswith(".taskapp"))

        with zipfile.ZipFile(io.BytesIO(archive_bytes), "r") as archive:
            self.assertIn("metadata.json", archive.namelist())
            self.assertIn("data/tasks.json", archive.namelist())
            self.assertIn("data/rewards.json", archive.namelist())
            self.assertIn("data/user.json", archive.namelist())
            self.assertIn("data/logs.db", archive.namelist())
            tasks_payload = json.loads(archive.read("data/tasks.json"))
            self.assertEqual(tasks_payload[0]["$type"], "Habit")

        imported_profile = Profile.objects.create(account=self.user, name="Imported")
        result = TaskAppPortabilityService.import_profile_archive(
            profile=imported_profile,
            user=self.user,
            archive_file=io.BytesIO(archive_bytes),
        )

        self.assertEqual(result["profile_id"], str(imported_profile.id))
        self.assertEqual(result["imported"]["tasks"], 1)
        self.assertEqual(result["imported"]["rewards"], 1)
        self.assertGreaterEqual(result["imported"]["logs"], 1)

        imported_profile.refresh_from_db()
        imported_tasks = Task.objects.filter(profile=imported_profile)
        self.assertEqual(imported_tasks.count(), 2)
        self.assertEqual(imported_profile.gold_balance, Decimal("42.5"))
        self.assertTrue(
            LogEntry.objects.filter(profile=imported_profile, type=LogEntry.LogType.ACTIVITY_DURATION).exists()
        )
        self.assertTrue(
            Task.objects.filter(profile=imported_profile, task_type=Task.TaskType.REWARD, title="Coffee").exists()
        )

    def test_import_numeric_weekly_cadence_does_not_false_positive_in_new_day_prompt(self):
        now = timezone.make_aware(datetime(2026, 2, 21, 12, 0, 0))
        archive_buffer = io.BytesIO()
        with zipfile.ZipFile(archive_buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(
                "metadata.json",
                json.dumps({"ExportedAt": "2026-02-21T00:00:00Z", "AppVersion": "1.0.0", "UserName": "Main"}),
            )
            archive.writestr("data/tags.json", "[]")
            archive.writestr("data/rewards.json", "[]")
            archive.writestr("data/user.json", json.dumps({"Id": str(self.profile.id), "Gold": 0}))
            archive.writestr(
                "data/tasks.json",
                json.dumps(
                    [
                        {
                            "$type": "Daily",
                            "Id": "11111111-1111-1111-1111-111111111111",
                            "CreatedAt": "2026-02-01T00:00:00Z",
                            "Title": "practice driving",
                            "Notes": "",
                            "Tags": [],
                            "LastCompletedDate": "2026-02-18T08:00:00Z",
                            "GoldReward": 1,
                            "IsHidden": False,
                            "Cadence": 1,
                            "RepeatEvery": 1,
                            "CurrentStreak": 5,
                            "BestStreak": 5,
                            "LastCompletionPeriod": "2026-02-16",
                            "RewardGoalFulfilled": False,
                            "AutocompleteTimeThresholdTicks": None,
                            "StreakBonusRules": [],
                        }
                    ]
                ),
            )

        imported_profile = Profile.objects.create(account=self.user, name="Imported Weekly")
        TaskAppPortabilityService.import_profile_archive(
            profile=imported_profile,
            user=self.user,
            archive_file=io.BytesIO(archive_buffer.getvalue()),
        )

        imported_daily = Task.objects.get(profile=imported_profile, title="practice driving")
        self.assertEqual(imported_daily.repeat_cadence, Task.Cadence.WEEK)
        self.assertEqual(imported_daily.last_completion_period.isoformat(), "2026-02-16")

        prompts = get_uncompleted_dailies_from_previous_period(profile=imported_profile, user=self.user, timestamp=now)
        self.assertFalse(any(item["title"] == "practice driving" for item in prompts))

    def test_import_todo_due_date_uses_import_timezone_wall_time(self):
        archive_buffer = io.BytesIO()
        with zipfile.ZipFile(archive_buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(
                "metadata.json",
                json.dumps({"ExportedAt": "2026-03-20T00:00:00Z", "AppVersion": "1.0.0", "UserName": "Main"}),
            )
            archive.writestr("data/tags.json", "[]")
            archive.writestr("data/rewards.json", "[]")
            archive.writestr("data/user.json", json.dumps({"Id": str(self.profile.id), "Gold": 0}))
            archive.writestr(
                "data/tasks.json",
                json.dumps(
                    [
                        {
                            "$type": "Todo",
                            "Id": "22222222-2222-2222-2222-222222222222",
                            "CreatedAt": "2026-03-10T00:00:00Z",
                            "Title": "DST edge todo",
                            "Notes": "",
                            "Tags": [],
                            "LastCompletedDate": None,
                            "GoldReward": 1,
                            "IsHidden": False,
                            "DueDate": "2026-03-15T23:59:59-08:00",
                            "Checklist": [],
                        }
                    ]
                ),
            )

        imported_profile = Profile.objects.create(account=self.user, name="Imported Todo DST")
        TaskAppPortabilityService.import_profile_archive(
            profile=imported_profile,
            user=self.user,
            archive_file=io.BytesIO(archive_buffer.getvalue()),
            import_timezone="America/Los_Angeles",
        )

        imported_todo = Task.objects.get(profile=imported_profile, title="DST edge todo")
        # 23:59:59 in America/Los_Angeles on 2026-03-15 is 06:59:59Z on 2026-03-16 (DST in effect).
        self.assertEqual(imported_todo.due_at.isoformat(), "2026-03-16T06:59:59+00:00")
