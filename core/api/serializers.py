from django.utils import timezone
from rest_framework import serializers

from core.models import Profile, Task


class TaskSerializer(serializers.ModelSerializer):
    profile_id = serializers.UUIDField(source="profile.id", read_only=True)

    class Meta:
        model = Task
        fields = [
            "id",
            "profile_id",
            "task_type",
            "title",
            "notes",
            "is_hidden",
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
    profile_id = serializers.UUIDField(write_only=True)

    class Meta:
        model = Task
        fields = [
            "id",
            "profile_id",
            "task_type",
            "title",
            "notes",
            "is_hidden",
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

    def validate(self, attrs):
        if self.instance and "profile_id" in attrs and attrs["profile_id"] != self.instance.profile_id:
            raise serializers.ValidationError({"profile_id": "Changing task profile is not supported."})
        return attrs

    def create(self, validated_data):
        request = self.context["request"]
        profile_id = validated_data.pop("profile_id")
        profile = Profile.objects.get(id=profile_id, account=request.user)
        task = Task(profile=profile, **validated_data)
        task.full_clean()
        task.save()
        return task

    def update(self, instance, validated_data):
        validated_data.pop("profile_id", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.full_clean()
        instance.save()
        return instance


class ActionSerializer(serializers.Serializer):
    profile_id = serializers.UUIDField()
    timestamp = serializers.DateTimeField(required=False, default=timezone.now)
    by = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    completion_period = serializers.DateField(required=False)
