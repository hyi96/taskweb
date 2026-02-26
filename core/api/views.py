from django.contrib.auth import authenticate, login, logout
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.api.serializers import (
    ActivityDurationSerializer,
    ActionSerializer,
    ChecklistItemSerializer,
    LogEntrySerializer,
    NewDayPreviewSerializer,
    NewDayStartSerializer,
    ProfileSerializer,
    StreakBonusRuleSerializer,
    TagSerializer,
    TaskCreateUpdateSerializer,
    TaskSerializer,
)
from core.models import ChecklistItem, LogEntry, Profile, StreakBonusRule, Tag, Task
from core.services.site_phrase import get_daily_phrase
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
from core.services.local_migration import LocalToCloudMigrationService
from core.services.taskapp_portability import TaskAppPortabilityService


def _to_drf_validation_error(exc: DjangoValidationError) -> ValidationError:
    if hasattr(exc, "message_dict"):
        return ValidationError(exc.message_dict)
    return ValidationError({"detail": exc.messages})


def _session_payload(request):
    user = request.user
    if not user.is_authenticated:
        return {"authenticated": False, "user_id": None, "username": None}
    return {"authenticated": True, "user_id": str(user.id), "username": user.get_username()}


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfCookieView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"detail": "CSRF cookie set."}, status=status.HTTP_200_OK)


class SessionStatusView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(_session_payload(request), status=status.HTTP_200_OK)


class DailyPhraseView(APIView):
    permission_classes = [AllowAny]

    def get(self, _request):
        today = timezone.localdate().isoformat()
        phrase = get_daily_phrase()
        return Response(
            {
                "date": today,
                "text": phrase["text"],
                "author": phrase["author"],
            },
            status=status.HTTP_200_OK,
        )


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        username = str(request.data.get("username", "")).strip()
        password = str(request.data.get("password", ""))
        if not username:
            raise ValidationError({"username": "This field is required."})
        if not password:
            raise ValidationError({"password": "This field is required."})
        user = authenticate(request, username=username, password=password)
        if user is None:
            raise ValidationError({"non_field_errors": ["Invalid username or password."]})
        if not user.is_active:
            raise ValidationError({"non_field_errors": ["This user account is inactive."]})
        login(request, user)
        return Response(_session_payload(request), status=status.HTTP_200_OK)


class LogoutView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        if request.user.is_authenticated:
            logout(request)
        return Response(_session_payload(request), status=status.HTTP_200_OK)


class SignupView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        username = str(request.data.get("username", "")).strip()
        email = str(request.data.get("email", "")).strip().lower()
        password = str(request.data.get("password", ""))
        password_confirm = str(request.data.get("password_confirm", ""))
        if not username:
            raise ValidationError({"username": "This field is required."})
        if not email:
            raise ValidationError({"email": "This field is required."})
        if not password:
            raise ValidationError({"password": "This field is required."})
        if password != password_confirm:
            raise ValidationError({"password_confirm": ["Passwords do not match."]})

        try:
            validate_email(email)
        except DjangoValidationError as exc:
            raise ValidationError({"email": exc.messages}) from exc

        user_model = get_user_model()
        if user_model.objects.filter(username=username).exists():
            raise ValidationError({"username": ["A user with that username already exists."]})
        if user_model.objects.filter(email__iexact=email).exists():
            raise ValidationError({"email": ["A user with that email already exists."]})

        try:
            validate_password(password)
        except DjangoValidationError as exc:
            raise ValidationError({"password": exc.messages}) from exc

        user = user_model.objects.create_user(username=username, email=email, password=password)
        Profile.objects.create(account=user, name="Default")
        login(request, user)
        return Response(_session_payload(request), status=status.HTTP_201_CREATED)


class ProfileScopedMixin:
    def _required_profile_id_from_query(self):
        profile_id = self.request.query_params.get("profile_id")
        if not profile_id:
            raise ValidationError({"profile_id": "This query parameter is required."})
        return profile_id

    def _profile_or_404(self, profile_id):
        return get_object_or_404(Profile.objects.filter(account=self.request.user), id=profile_id)


class ProfileViewSet(viewsets.ModelViewSet):
    serializer_class = ProfileSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        return Profile.objects.filter(account=self.request.user).order_by("created_at")

    def perform_create(self, serializer):
        serializer.save(account=self.request.user)

    @action(detail=True, methods=["get"], url_path="export-taskapp", url_name="export-taskapp")
    def export_taskapp(self, request, pk=None):
        profile = self.get_object()
        archive_bytes, filename = TaskAppPortabilityService.export_profile_archive(profile=profile, user=request.user)
        response = HttpResponse(archive_bytes, content_type="application/zip")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(detail=True, methods=["post"], url_path="import-taskapp", url_name="import-taskapp")
    def import_taskapp(self, request, pk=None):
        profile = self.get_object()
        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError({"file": "This file field is required."})
        try:
            result = TaskAppPortabilityService.import_profile_archive(
                profile=profile,
                user=request.user,
                archive_file=upload,
            )
        except DjangoValidationError as exc:
            raise _to_drf_validation_error(exc) from exc
        return Response(result, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="migrate-local", url_name="migrate-local")
    def migrate_local(self, request, pk=None):
        profile = self.get_object()
        if not isinstance(request.data, dict):
            raise ValidationError({"detail": "Invalid migration payload."})
        try:
            result = LocalToCloudMigrationService.migrate(
                profile=profile,
                user=request.user,
                payload=request.data,
            )
        except DjangoValidationError as exc:
            raise _to_drf_validation_error(exc) from exc
        return Response(result, status=status.HTTP_200_OK)


class TagViewSet(ProfileScopedMixin, viewsets.ModelViewSet):
    serializer_class = TagSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = Tag.objects.filter(profile__account=self.request.user).select_related("profile")
        profile_id = self.request.query_params.get("profile_id")
        if profile_id:
            self._profile_or_404(profile_id)
            queryset = queryset.filter(profile_id=profile_id)
        elif self.action == "list":
            queryset = queryset.none()
        return queryset.order_by("name")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context


class ChecklistItemViewSet(ProfileScopedMixin, viewsets.ModelViewSet):
    serializer_class = ChecklistItemSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = ChecklistItem.objects.filter(task__profile__account=self.request.user).select_related("task")
        profile_id = self.request.query_params.get("profile_id")
        if profile_id:
            self._profile_or_404(profile_id)
            queryset = queryset.filter(task__profile_id=profile_id)
        elif self.action == "list":
            queryset = queryset.none()

        task_id = self.request.query_params.get("task_id")
        if task_id:
            queryset = queryset.filter(task_id=task_id)
        return queryset.order_by("task_id", "sort_order", "created_at")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context


class StreakBonusRuleViewSet(ProfileScopedMixin, viewsets.ModelViewSet):
    serializer_class = StreakBonusRuleSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = StreakBonusRule.objects.filter(task__profile__account=self.request.user).select_related("task")
        profile_id = self.request.query_params.get("profile_id")
        if profile_id:
            self._profile_or_404(profile_id)
            queryset = queryset.filter(task__profile_id=profile_id)
        elif self.action == "list":
            queryset = queryset.none()

        task_id = self.request.query_params.get("task_id")
        if task_id:
            queryset = queryset.filter(task_id=task_id)
        return queryset.order_by("task_id", "streak_goal", "created_at")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context


class LogEntryViewSet(ProfileScopedMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = LogEntrySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        profile_id = self._required_profile_id_from_query()
        self._profile_or_404(profile_id)
        queryset = LogEntry.objects.filter(profile_id=profile_id, profile__account=self.request.user).order_by("-timestamp")

        log_type = self.request.query_params.get("type")
        if log_type:
            queryset = queryset.filter(type=log_type)

        task_id = self.request.query_params.get("task_id")
        if task_id:
            queryset = queryset.filter(task_id=task_id)

        reward_id = self.request.query_params.get("reward_id")
        if reward_id:
            queryset = queryset.filter(reward_id=reward_id)

        date_from = self.request.query_params.get("from")
        if date_from:
            queryset = queryset.filter(timestamp__date__gte=date_from)

        date_to = self.request.query_params.get("to")
        if date_to:
            queryset = queryset.filter(timestamp__date__lte=date_to)

        limit = self.request.query_params.get("limit")
        if limit:
            try:
                value = max(1, min(int(limit), 500))
                return queryset[:value]
            except ValueError:
                raise ValidationError({"limit": "limit must be an integer."}) from None

        return queryset


class TaskViewSet(ProfileScopedMixin, viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = Task.objects.filter(profile__account=self.request.user).select_related("profile")
        profile_id = self.request.query_params.get("profile_id")
        if profile_id:
            self._profile_or_404(profile_id)
            queryset = queryset.filter(profile_id=profile_id)
        elif self.action == "list":
            queryset = queryset.none()
        return queryset

    def get_serializer_class(self):
        if self.action in {"create", "update", "partial_update"}:
            return TaskCreateUpdateSerializer
        return TaskSerializer

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
        profile = self._profile_or_404(profile_id)
        try:
            refresh_profile_period_state(profile=profile, user=request.user)
        except DjangoValidationError as exc:
            raise _to_drf_validation_error(exc) from exc
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        profile_id = self._required_profile_id_from_query()
        profile = self._profile_or_404(profile_id)
        try:
            refresh_profile_period_state(profile=profile, user=request.user)
        except DjangoValidationError as exc:
            raise _to_drf_validation_error(exc) from exc
        return super().retrieve(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        write_serializer = self.get_serializer(data=request.data)
        write_serializer.is_valid(raise_exception=True)
        self.perform_create(write_serializer)
        read_serializer = TaskSerializer(write_serializer.instance)
        return Response(read_serializer.data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        write_serializer = self.get_serializer(instance, data=request.data, partial=partial)
        write_serializer.is_valid(raise_exception=True)
        self.perform_update(write_serializer)
        read_serializer = TaskSerializer(write_serializer.instance)
        return Response(read_serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="habit-increment", url_name="habit-increment")
    def habit_increment_action(self, request, pk=None):
        data = self._action_payload(request)
        profile = self._profile_or_404(data["profile_id"])
        try:
            refresh_profile_period_state(profile=profile, user=request.user)
        except DjangoValidationError as exc:
            raise _to_drf_validation_error(exc) from exc
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
        try:
            refresh_profile_period_state(profile=profile, user=request.user)
        except DjangoValidationError as exc:
            raise _to_drf_validation_error(exc) from exc
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
        try:
            refresh_profile_period_state(profile=profile, user=request.user)
        except DjangoValidationError as exc:
            raise _to_drf_validation_error(exc) from exc
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
        try:
            refresh_profile_period_state(profile=profile, user=request.user)
        except DjangoValidationError as exc:
            raise _to_drf_validation_error(exc) from exc
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


class ActivityDurationViewSet(ProfileScopedMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    serializer_class = ActivityDurationSerializer
    permission_classes = [IsAuthenticated]
    queryset = LogEntry.objects.none()

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        profile = self._profile_or_404(data["profile_id"])
        task = None
        reward = None
        task_id = data.get("task_id")
        reward_id = data.get("reward_id")
        if task_id:
            task = get_object_or_404(Task.objects.filter(profile=profile, profile__account=request.user), id=task_id)
        if reward_id:
            reward = get_object_or_404(
                Task.objects.filter(profile=profile, profile__account=request.user, task_type=Task.TaskType.REWARD),
                id=reward_id,
            )
        try:
            entry = log_activity_duration(
                profile=profile,
                user=request.user,
                duration=data["duration"],
                title=data["title"],
                timestamp=data["timestamp"],
                task=task,
                reward=reward,
            )
        except DjangoValidationError as exc:
            raise _to_drf_validation_error(exc) from exc
        return Response(LogEntrySerializer(entry).data, status=status.HTTP_201_CREATED)


class NewDayViewSet(ProfileScopedMixin, viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def list(self, request):
        profile_id = self._required_profile_id_from_query()
        profile = self._profile_or_404(profile_id)
        try:
            refresh_profile_period_state(profile=profile, user=request.user)
            dailies = get_uncompleted_dailies_from_previous_period(profile=profile, user=request.user)
        except DjangoValidationError as exc:
            raise _to_drf_validation_error(exc) from exc
        payload = {"profile_id": str(profile.id), "dailies": dailies}
        serializer = NewDayPreviewSerializer(payload)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def create(self, request):
        serializer = NewDayStartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        profile = self._profile_or_404(data["profile_id"])
        try:
            result = start_new_day(
                profile=profile,
                user=request.user,
                checked_daily_ids=data.get("checked_daily_ids", []),
            )
        except DjangoValidationError as exc:
            raise _to_drf_validation_error(exc) from exc
        return Response(result, status=status.HTTP_200_OK)
