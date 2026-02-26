from __future__ import annotations

import json
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

from django.core.management.base import BaseCommand

from core.models import InspirationalPhrase

QUOTABLE_ENDPOINTS = [
    "https://api.quotable.io/quotes",
    "http://api.quotable.io/quotes",
]
DEFAULT_TAGS = "inspirational|wisdom|success"


def _fetch_page(url: str, timeout: int, retries: int) -> dict:
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            with urlopen(url, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError) as exc:
            last_error = exc
            if attempt < retries - 1:
                time.sleep(1.0 + attempt * 0.5)
    raise RuntimeError(f"Failed to fetch quotes: {last_error}")


def parse_quotes_payload(payload: object) -> list[tuple[str, str]]:
    rows: list[dict] = []
    if isinstance(payload, dict):
        results = payload.get("results")
        if isinstance(results, list):
            rows = [item for item in results if isinstance(item, dict)]
    elif isinstance(payload, list):
        rows = [item for item in payload if isinstance(item, dict)]

    phrases: list[tuple[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        content = str(row.get("content", "")).strip()
        if not content:
            continue
        key = content.lower()
        if key in seen:
            continue
        seen.add(key)
        author = str(row.get("author", "")).strip() or "Unknown"
        phrases.append((content, author[:120]))
    return phrases


def fetch_from_quotable(*, target: int, tags: str, page_size: int = 50, timeout: int = 15, retries: int = 3) -> list[tuple[str, str]]:
    for endpoint in QUOTABLE_ENDPOINTS:
        page = 1
        phrases: list[tuple[str, str]] = []
        seen: set[str] = set()
        try:
            while len(phrases) < target:
                params = urlencode({"page": page, "limit": page_size, "tags": tags})
                url = f"{endpoint}?{params}"
                payload = _fetch_page(url=url, timeout=timeout, retries=retries)
                results = payload.get("results", [])
                if not results:
                    break

                batch = parse_quotes_payload(results)
                for content, author in batch:
                    key = content.lower()
                    if key in seen:
                        continue
                    seen.add(key)
                    phrases.append((content, author))
                    if len(phrases) >= target:
                        break
                page += 1
        except RuntimeError:
            phrases = []

        if phrases:
            return phrases[:target]

    raise RuntimeError("Failed to fetch quotes from Quotable using both HTTPS and HTTP endpoints.")


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
            "--tags",
            type=str,
            default=DEFAULT_TAGS,
            help="Quotable tags filter (pipe-separated).",
        )

    def handle(self, *args, **options):
        target = max(1, int(options["target"]))
        replace = bool(options["replace"])
        confirm = bool(options["yes"])
        tags = str(options["tags"]).strip() or DEFAULT_TAGS

        if replace and not confirm:
            self.stderr.write("Refusing to run --replace without --yes confirmation.")
            self.stderr.write("Re-run with: --replace --yes")
            return

        phrase_bank = fetch_from_quotable(target=target, tags=tags)
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
