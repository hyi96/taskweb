from django.contrib import admin

from core.models import ChecklistItem, LogEntry, Profile, StreakBonusRule, Tag, Task


class ChecklistItemInline(admin.TabularInline):
    model = ChecklistItem
    extra = 0


class StreakBonusRuleInline(admin.TabularInline):
    model = StreakBonusRule
    extra = 0


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("name", "account", "gold_balance", "created_at")
    list_filter = ("created_at",)
    search_fields = ("name", "account__username", "account__email")
    readonly_fields = ("created_at",)


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ("name", "profile", "is_system", "created_at")
    list_filter = ("is_system", "created_at")
    search_fields = ("name", "profile__name", "profile__account__username")
    readonly_fields = ("created_at",)


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "task_type",
        "profile",
        "gold_delta",
        "is_done",
        "is_claimed",
        "total_actions_count",
        "last_action_at",
        "created_at",
    )
    list_filter = ("task_type", "is_hidden", "is_done", "is_claimed", "is_repeatable")
    search_fields = ("title", "notes", "profile__name", "profile__account__username")
    readonly_fields = ("created_at", "updated_at")
    filter_horizontal = ("tags",)
    inlines = (ChecklistItemInline, StreakBonusRuleInline)


@admin.register(ChecklistItem)
class ChecklistItemAdmin(admin.ModelAdmin):
    list_display = ("text", "task", "is_completed", "sort_order", "created_at")
    list_filter = ("is_completed", "created_at")
    search_fields = ("text", "task__title", "task__profile__name")
    readonly_fields = ("created_at",)


@admin.register(StreakBonusRule)
class StreakBonusRuleAdmin(admin.ModelAdmin):
    list_display = ("task", "streak_goal", "bonus_percent", "created_at")
    list_filter = ("created_at",)
    search_fields = ("task__title", "task__profile__name")
    readonly_fields = ("created_at",)


@admin.register(LogEntry)
class LogEntryAdmin(admin.ModelAdmin):
    list_display = ("type", "profile", "task", "reward", "gold_delta", "user_gold", "timestamp", "created_at")
    list_filter = ("type", "created_at")
    search_fields = ("title_snapshot", "profile__name", "profile__account__username", "task__title")
    readonly_fields = ("created_at",)
