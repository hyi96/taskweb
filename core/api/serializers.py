from django.utils import timezone
from rest_framework import serializers

from core.models import ChecklistItem, LogEntry, Profile, StreakBonusRule, Tag, Task


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = ["id", "name", "gold_balance", "created_at"]
        read_only_fields = ["id", "gold_balance", "created_at"]


class TagSerializer(serializers.ModelSerializer):
    profile_id = serializers.UUIDField(source="profile.id", read_only=True)
    profile = serializers.PrimaryKeyRelatedField(
        queryset=Profile.objects.none(),
        write_only=True,
        required=False,
    )

    class Meta:
        model = Tag
        fields = ["id", "profile_id", "profile", "name", "is_system", "created_at"]
        read_only_fields = ["id", "is_system", "created_at", "profile_id"]

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            fields["profile"].queryset = Profile.objects.filter(account=request.user)
        return fields

    def validate_profile(self, value):
        request = self.context["request"]
        if value.account_id != request.user.id:
            raise serializers.ValidationError("Profile does not belong to the authenticated user.")
        return value

    def create(self, validated_data):
        request = self.context["request"]
        profile = validated_data.pop("profile", None)
        if not profile:
            raise serializers.ValidationError({"profile": "This field is required."})
        if profile.account_id != request.user.id:
            raise serializers.ValidationError({"profile": "Invalid profile for this user."})
        instance = Tag(profile=profile, **validated_data)
        instance.full_clean()
        instance.save()
        return instance


class ChecklistItemSerializer(serializers.ModelSerializer):
    task_id = serializers.UUIDField(source="task.id", read_only=True)
    task = serializers.PrimaryKeyRelatedField(queryset=Task.objects.none(), write_only=True, required=False)

    class Meta:
        model = ChecklistItem
        fields = ["id", "task_id", "task", "text", "is_completed", "sort_order", "created_at"]
        read_only_fields = ["id", "created_at", "task_id"]

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            fields["task"].queryset = Task.objects.filter(profile__account=request.user)
        return fields

    def validate_task(self, value):
        request = self.context["request"]
        if value.profile.account_id != request.user.id:
            raise serializers.ValidationError("Task does not belong to the authenticated user.")
        if value.task_type != Task.TaskType.TODO:
            raise serializers.ValidationError("Checklist items require a TODO task.")
        return value

    def create(self, validated_data):
        task = validated_data.pop("task", None)
        if not task:
            raise serializers.ValidationError({"task": "This field is required."})
        instance = ChecklistItem(task=task, **validated_data)
        instance.full_clean()
        instance.save()
        return instance


class StreakBonusRuleSerializer(serializers.ModelSerializer):
    task_id = serializers.UUIDField(source="task.id", read_only=True)
    task = serializers.PrimaryKeyRelatedField(queryset=Task.objects.none(), write_only=True, required=False)

    class Meta:
        model = StreakBonusRule
        fields = ["id", "task_id", "task", "streak_goal", "bonus_percent", "created_at"]
        read_only_fields = ["id", "created_at", "task_id"]

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            fields["task"].queryset = Task.objects.filter(profile__account=request.user)
        return fields

    def validate_task(self, value):
        request = self.context["request"]
        if value.profile.account_id != request.user.id:
            raise serializers.ValidationError("Task does not belong to the authenticated user.")
        if value.task_type != Task.TaskType.DAILY:
            raise serializers.ValidationError("Streak bonus rules require a DAILY task.")
        return value

    def create(self, validated_data):
        task = validated_data.pop("task", None)
        if not task:
            raise serializers.ValidationError({"task": "This field is required."})
        instance = StreakBonusRule(task=task, **validated_data)
        instance.full_clean()
        instance.save()
        return instance


class LogEntrySerializer(serializers.ModelSerializer):
    profile_id = serializers.UUIDField(source="profile.id", read_only=True)

    class Meta:
        model = LogEntry
        fields = [
            "id",
            "profile_id",
            "timestamp",
            "created_at",
            "type",
            "task_id",
            "reward_id",
            "gold_delta",
            "user_gold",
            "count_delta",
            "duration",
            "title_snapshot",
        ]
        read_only_fields = fields


class TaskSerializer(serializers.ModelSerializer):
    profile_id = serializers.UUIDField(source="profile.id", read_only=True)
    tag_ids = serializers.PrimaryKeyRelatedField(many=True, source="tags", read_only=True)

    class Meta:
        model = Task
        fields = [
            "id",
            "profile_id",
            "task_type",
            "title",
            "notes",
            "is_hidden",
            "tag_ids",
            "created_at",
            "updated_at",
            "last_action_at",
            "total_actions_count",
            "gold_delta",
            "current_count",
            "count_increment",
            "count_reset_cadence",
            "repeat_cadence",
            "repeat_every",
            "current_streak",
            "best_streak",
            "streak_goal",
            "last_completion_period",
            "autocomplete_time_threshold",
            "due_at",
            "is_done",
            "completed_at",
            "is_repeatable",
            "is_claimed",
            "claimed_at",
            "claim_count",
        ]


class TaskCreateUpdateSerializer(serializers.ModelSerializer):
    profile_id = serializers.UUIDField(write_only=True, required=False)
    tag_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        source="tags",
        queryset=Tag.objects.none(),
        required=False,
    )

    class Meta:
        model = Task
        fields = [
            "id",
            "profile_id",
            "task_type",
            "title",
            "notes",
            "is_hidden",
            "tag_ids",
            "gold_delta",
            "count_increment",
            "count_reset_cadence",
            "repeat_cadence",
            "repeat_every",
            "streak_goal",
            "autocomplete_time_threshold",
            "due_at",
            "is_repeatable",
        ]
        read_only_fields = ["id"]

    def validate_profile_id(self, value):
        request = self.context["request"]
        exists = Profile.objects.filter(id=value, account=request.user).exists()
        if not exists:
            raise serializers.ValidationError("Invalid profile for the authenticated user.")
        return value

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            fields["tag_ids"].child_relation.queryset = Tag.objects.filter(profile__account=request.user)
        return fields

    def validate(self, attrs):
        tags = attrs.get("tags")
        if tags is not None:
            if self.instance:
                profile = self.instance.profile
            else:
                profile_id = attrs.get("profile_id")
                if not profile_id:
                    raise serializers.ValidationError({"profile_id": "This field is required."})
                profile = Profile.objects.filter(id=profile_id, account=self.context["request"].user).first()
                if not profile:
                    raise serializers.ValidationError({"profile_id": "Invalid profile for the authenticated user."})
            invalid_tags = [str(tag.id) for tag in tags if tag.profile_id != profile.id]
            if invalid_tags:
                raise serializers.ValidationError(
                    {"tag_ids": "All tags must belong to the same profile as the task."}
                )
        if self.instance and "profile_id" in attrs and attrs["profile_id"] != self.instance.profile_id:
            raise serializers.ValidationError({"profile_id": "Changing task profile is not supported."})
        return attrs

    def create(self, validated_data):
        request = self.context["request"]
        profile_id = validated_data.pop("profile_id", None)
        tags = validated_data.pop("tags", None)
        if profile_id is None:
            raise serializers.ValidationError({"profile_id": "This field is required."})
        profile = Profile.objects.get(id=profile_id, account=request.user)
        task = Task(profile=profile, **validated_data)
        task.full_clean()
        task.save()
        if tags is not None:
            task.tags.set(tags)
        return task

    def update(self, instance, validated_data):
        tags = validated_data.pop("tags", None)
        validated_data.pop("profile_id", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.full_clean()
        instance.save()
        if tags is not None:
            instance.tags.set(tags)
        return instance


class ActionSerializer(serializers.Serializer):
    profile_id = serializers.UUIDField()
    timestamp = serializers.DateTimeField(required=False, default=timezone.now)
    by = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    completion_period = serializers.DateField(required=False)


class ActivityDurationSerializer(serializers.Serializer):
    profile_id = serializers.UUIDField()
    duration = serializers.DurationField()
    title = serializers.CharField(max_length=200)
    task_id = serializers.UUIDField(required=False, allow_null=True)
    reward_id = serializers.UUIDField(required=False, allow_null=True)
    timestamp = serializers.DateTimeField(required=False, default=timezone.now)
