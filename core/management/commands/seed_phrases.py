from __future__ import annotations

import json
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from django.core.management.base import BaseCommand

from core.models import InspirationalPhrase

ZENQUOTES_RANDOM_ENDPOINT = "https://zenquotes.io/api/random"
ZENQUOTES_BULK_ENDPOINTS = [
    "https://zenquotes.io/api/quotes",
    "https://zenquotes.io/api/quotes/100",
]


def _fetch_page(url: str, timeout: int, retries: int) -> object:
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            with urlopen(url, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            last_error = exc
            if exc.code == 429 and attempt < retries - 1:
                time.sleep(5.0 + attempt * 2.0)
                continue
            if attempt < retries - 1:
                time.sleep(1.0 + attempt * 0.5)
        except (URLError, TimeoutError) as exc:
            last_error = exc
            if attempt < retries - 1:
                time.sleep(1.0 + attempt * 0.5)
    raise RuntimeError(f"Failed to fetch quotes: {last_error}")


def parse_quotes_payload(payload: object) -> list[tuple[str, str]]:
    rows: list[dict] = [item for item in payload if isinstance(item, dict)] if isinstance(payload, list) else []
    phrases: list[tuple[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        content = str(row.get("q", "")).strip()
        if not content:
            continue
        key = content.lower()
        if key in seen:
            continue
        seen.add(key)
        author = str(row.get("a", "")).strip() or "Unknown"
        phrases.append((content, author[:120]))
    return phrases


def fetch_from_zenquotes(*, target: int, timeout: int = 15, retries: int = 3, max_attempts: int = 2000) -> list[tuple[str, str]]:
    # Try bulk endpoints first to avoid random-endpoint rate limits.
    for endpoint in ZENQUOTES_BULK_ENDPOINTS:
        try:
            payload = _fetch_page(url=endpoint, timeout=timeout, retries=retries)
            phrases = parse_quotes_payload(payload)
            if phrases:
                return phrases[:target]
        except RuntimeError:
            pass

    phrases: list[tuple[str, str]] = []
    seen: set[str] = set()
    attempts = 0

    while len(phrases) < target and attempts < max_attempts:
        attempts += 1
        payload = _fetch_page(url=ZENQUOTES_RANDOM_ENDPOINT, timeout=timeout, retries=retries)
        batch = parse_quotes_payload(payload)
        if not batch:
            continue

        content, author = batch[0]
        key = content.lower()
        if key in seen:
            continue
        seen.add(key)
        phrases.append((content, author))
        time.sleep(0.15)

    if not phrases:
        raise RuntimeError("Failed to fetch quotes from ZenQuotes.")
    return phrases[:target]


class Command(BaseCommand):
    help = "Seed inspirational phrases from a public API for quote-of-the-day."

    def add_arguments(self, parser):
        parser.add_argument(
            "--target",
            type=int,
            default=200,
            help="Target number of phrases to ensure in database.",
        )
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Delete existing phrases before inserting fresh seed data.",
        )
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Confirm destructive operations (required with --replace).",
        )
        parser.add_argument(
            "--max-attempts",
            type=int,
            default=2000,
            help="Maximum API calls while collecting unique quotes.",
        )

    def handle(self, *args, **options):
        target = max(1, int(options["target"]))
        replace = bool(options["replace"])
        confirm = bool(options["yes"])
        max_attempts = max(1, int(options["max_attempts"]))

        if replace and not confirm:
            self.stderr.write("Refusing to run --replace without --yes confirmation.")
            self.stderr.write("Re-run with: --replace --yes")
            return

        phrase_bank = fetch_from_zenquotes(target=target, max_attempts=max_attempts)
        if not phrase_bank:
            self.stdout.write(self.style.WARNING("No phrases loaded; no changes applied."))
            return

        if replace:
            deleted, _ = InspirationalPhrase.objects.all().delete()
            self.stdout.write(f"Deleted {deleted} existing phrase rows.")

        created = 0
        updated = 0

        for idx, (text, author) in enumerate(phrase_bank, start=1):
            obj, was_created = InspirationalPhrase.objects.update_or_create(
                text=text,
                defaults={
                    "author": author[:120],
                    "is_active": True,
                    "sort_order": idx,
                },
            )
            if was_created:
                created += 1
            else:
                updated += 1

        total = InspirationalPhrase.objects.count()
        self.stdout.write(
            self.style.SUCCESS(
                f"Seed complete: created={created}, updated={updated}, total={total}, fetched={len(phrase_bank)}, target={target}"
            )
        )
