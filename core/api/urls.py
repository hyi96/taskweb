from django.urls import path
from rest_framework.routers import DefaultRouter

from core.api.views import (
    ActivityDurationViewSet,
    CsrfCookieView,
    DailyPhraseView,
    ChecklistItemViewSet,
    LoginView,
    LogEntryViewSet,
    NewDayViewSet,
    LogoutView,
    ProfileViewSet,
    SessionStatusView,
    SignupView,
    StreakBonusRuleViewSet,
    TagViewSet,
    TaskViewSet,
)

router = DefaultRouter()
router.register("profiles", ProfileViewSet, basename="profile")
router.register("tags", TagViewSet, basename="tag")
router.register("tasks", TaskViewSet, basename="task")
router.register("checklist-items", ChecklistItemViewSet, basename="checklist-item")
router.register("streak-bonus-rules", StreakBonusRuleViewSet, basename="streak-bonus-rule")
router.register("logs", LogEntryViewSet, basename="log")
router.register("activity-duration", ActivityDurationViewSet, basename="activity-duration")
router.register("new-day", NewDayViewSet, basename="new-day")

urlpatterns = [
    path("site/daily-phrase/", DailyPhraseView.as_view(), name="site-daily-phrase"),
    path("auth/csrf/", CsrfCookieView.as_view(), name="auth-csrf"),
    path("auth/session/", SessionStatusView.as_view(), name="auth-session"),
    path("auth/login/", LoginView.as_view(), name="auth-login"),
    path("auth/signup/", SignupView.as_view(), name="auth-signup"),
    path("auth/logout/", LogoutView.as_view(), name="auth-logout"),
]
urlpatterns += router.urls
