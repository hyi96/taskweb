from __future__ import annotations

from datetime import date

from django.utils import timezone

from core.models import InspirationalPhrase

FALLBACK_PHRASE = {
    "text": "Build your day with deliberate courage.",
    "author": "Taskweb",
}


def _active_phrases_queryset():
    return InspirationalPhrase.objects.filter(is_active=True).order_by("sort_order", "created_at", "id")


def get_daily_phrase(*, for_date: date | None = None) -> dict[str, str]:
    target_date = for_date or timezone.localdate()
    queryset = _active_phrases_queryset()
    count = queryset.count()
    if count == 0:
        return FALLBACK_PHRASE
    index = target_date.toordinal() % count
    phrase = queryset[index]
    return {"text": phrase.text, "author": phrase.author}

