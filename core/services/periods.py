from __future__ import annotations

from datetime import date, datetime, timedelta

from django.utils import timezone

from core.models import Task


def local_date_from_dt(value: datetime | None = None) -> date:
    dt = value or timezone.now()
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return timezone.localtime(dt).date()


def _monday_start(value: date) -> date:
    return value - timedelta(days=value.weekday())


def daily_period_start(*, target_date: date, cadence: str | None, repeat_every: int, anchor_date: date) -> date:
    interval = max(1, int(repeat_every or 1))
    if cadence == Task.Cadence.DAY:
        days_diff = max(0, (target_date - anchor_date).days)
        return anchor_date + timedelta(days=(days_diff // interval) * interval)

    if cadence == Task.Cadence.WEEK:
        current_start = _monday_start(target_date)
        anchor_start = _monday_start(anchor_date)
        weeks_diff = max(0, (current_start - anchor_start).days // 7)
        return anchor_start + timedelta(days=(weeks_diff // interval) * interval * 7)

    if cadence == Task.Cadence.MONTH:
        anchor_month_idx = anchor_date.year * 12 + anchor_date.month - 1
        current_month_idx = target_date.year * 12 + target_date.month - 1
        months_diff = max(0, current_month_idx - anchor_month_idx)
        period_idx = (months_diff // interval) * interval
        target_idx = anchor_month_idx + period_idx
        year = target_idx // 12
        month = target_idx % 12 + 1
        return date(year, month, 1)

    if cadence == Task.Cadence.YEAR:
        years_diff = max(0, target_date.year - anchor_date.year)
        return date(anchor_date.year + (years_diff // interval) * interval, 1, 1)

    return target_date


def previous_daily_period_start(*, current_period_start: date, cadence: str | None, repeat_every: int) -> date:
    interval = max(1, int(repeat_every or 1))
    if cadence == Task.Cadence.DAY:
        return current_period_start - timedelta(days=interval)
    if cadence == Task.Cadence.WEEK:
        return current_period_start - timedelta(days=7 * interval)
    if cadence == Task.Cadence.MONTH:
        month = current_period_start.month - interval
        year = current_period_start.year
        while month <= 0:
            month += 12
            year -= 1
        return date(year, month, 1)
    if cadence == Task.Cadence.YEAR:
        return date(current_period_start.year - interval, 1, 1)
    return current_period_start


def habit_reset_period_start(*, target_date: date, cadence: str | None) -> date:
    if cadence == Task.Cadence.DAY:
        return target_date
    if cadence == Task.Cadence.WEEK:
        return _monday_start(target_date)
    if cadence == Task.Cadence.MONTH:
        return date(target_date.year, target_date.month, 1)
    if cadence == Task.Cadence.YEAR:
        return date(target_date.year, 1, 1)
    return target_date
