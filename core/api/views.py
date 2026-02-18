from django.core.exceptions import ValidationError as DjangoValidationError
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.api.serializers import ActionSerializer, TaskCreateUpdateSerializer, TaskSerializer
from core.models import Profile, Task
from core.services.task_actions import daily_complete, habit_increment, reward_claim, todo_complete


def _to_drf_validation_error(exc: DjangoValidationError) -> ValidationError:
    if hasattr(exc, "message_dict"):
        return ValidationError(exc.message_dict)
    return ValidationError({"detail": exc.messages})


class TaskViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = Task.objects.filter(profile__account=self.request.user).select_related("profile")
        profile_id = self.request.query_params.get("profile_id")
        if profile_id:
            queryset = queryset.filter(profile_id=profile_id)
        else:
            queryset = queryset.none()
        return queryset

    def get_serializer_class(self):
        if self.action in {"create", "update", "partial_update"}:
            return TaskCreateUpdateSerializer
        return TaskSerializer

    def _profile_or_404(self, profile_id):
        return get_object_or_404(Profile.objects.filter(account=self.request.user), id=profile_id)

    def _required_profile_id_from_query(self):
        profile_id = self.request.query_params.get("profile_id")
        if not profile_id:
            raise ValidationError({"profile_id": "This query parameter is required."})
        return profile_id

    def _action_payload(self, request):
        payload = request.data.copy()
        if "profile_id" not in payload:
            qp_profile = request.query_params.get("profile_id")
            if qp_profile:
                payload["profile_id"] = qp_profile
        serializer = ActionSerializer(data=payload)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data

    def _task_or_404(self, profile, pk):
        return get_object_or_404(
            Task.objects.select_related("profile").filter(profile=profile, profile__account=self.request.user),
            id=pk,
        )

    def list(self, request, *args, **kwargs):
        profile_id = self._required_profile_id_from_query()
        self._profile_or_404(profile_id)
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        profile_id = self._required_profile_id_from_query()
        self._profile_or_404(profile_id)
        return super().retrieve(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="habit-increment", url_name="habit-increment")
    def habit_increment_action(self, request, pk=None):
        data = self._action_payload(request)
        profile = self._profile_or_404(data["profile_id"])
        task = self._task_or_404(profile, pk)
        try:
            updated_task = habit_increment(
                task=task,
                profile=profile,
                user=request.user,
                by=data.get("by"),
                timestamp=data["timestamp"],
            )
        except DjangoValidationError as exc:
            raise _to_drf_validation_error(exc) from exc
        return Response(TaskSerializer(updated_task).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="daily-complete", url_name="daily-complete")
    def daily_complete_action(self, request, pk=None):
        data = self._action_payload(request)
        profile = self._profile_or_404(data["profile_id"])
        task = self._task_or_404(profile, pk)
        try:
            updated_task = daily_complete(
                task=task,
                profile=profile,
                user=request.user,
                timestamp=data["timestamp"],
                completion_period=data.get("completion_period"),
            )
        except DjangoValidationError as exc:
            raise _to_drf_validation_error(exc) from exc
        return Response(TaskSerializer(updated_task).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="todo-complete", url_name="todo-complete")
    def todo_complete_action(self, request, pk=None):
        data = self._action_payload(request)
        profile = self._profile_or_404(data["profile_id"])
        task = self._task_or_404(profile, pk)
        try:
            updated_task = todo_complete(
                task=task,
                profile=profile,
                user=request.user,
                timestamp=data["timestamp"],
            )
        except DjangoValidationError as exc:
            raise _to_drf_validation_error(exc) from exc
        return Response(TaskSerializer(updated_task).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="reward-claim", url_name="reward-claim")
    def reward_claim_action(self, request, pk=None):
        data = self._action_payload(request)
        profile = self._profile_or_404(data["profile_id"])
        task = self._task_or_404(profile, pk)
        try:
            updated_task = reward_claim(
                task=task,
                profile=profile,
                user=request.user,
                timestamp=data["timestamp"],
            )
        except DjangoValidationError as exc:
            raise _to_drf_validation_error(exc) from exc
        return Response(TaskSerializer(updated_task).data, status=status.HTTP_200_OK)
