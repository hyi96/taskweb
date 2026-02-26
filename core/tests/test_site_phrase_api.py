from datetime import date
from unittest.mock import patch

from django.urls import reverse
from django.test import TestCase

from core.models import InspirationalPhrase
from core.services.site_phrase import get_daily_phrase


class DailyPhraseApiTests(TestCase):
    def test_daily_phrase_endpoint_returns_fallback_when_no_active_phrases(self):
        response = self.client.get(reverse("site-daily-phrase"))
        self.assertEqual(response.status_code, 200)
        self.assertIn("text", response.json())
        self.assertIn("author", response.json())

    def test_daily_phrase_selection_is_deterministic_for_date(self):
        InspirationalPhrase.objects.create(text="Build in silence.", author="Anonymous", sort_order=1, is_active=True)
        InspirationalPhrase.objects.create(text="Discipline before motivation.", author="Unknown", sort_order=2, is_active=True)

        phrase_a = get_daily_phrase(for_date=date(2026, 2, 25))
        phrase_b = get_daily_phrase(for_date=date(2026, 2, 25))
        self.assertEqual(phrase_a, phrase_b)

    def test_daily_phrase_endpoint_includes_author(self):
        InspirationalPhrase.objects.create(text="One task forward.", author="Taskweb", sort_order=1, is_active=True)
        with patch("core.api.views.timezone.localdate", return_value=date(2026, 2, 25)):
            response = self.client.get(reverse("site-daily-phrase"))
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["author"], "Taskweb")
        self.assertEqual(payload["text"], "One task forward.")
        self.assertEqual(payload["date"], "2026-02-25")

