from rest_framework.routers import DefaultRouter

from core.api.views import (
    ActivityDurationViewSet,
    ChecklistItemViewSet,
    LogEntryViewSet,
    NewDayViewSet,
    ProfileViewSet,
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

urlpatterns = router.urls
