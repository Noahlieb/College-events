"""
activity.py — is a deal still active, or expired?

filter_deals.py used to treat every kept post identically regardless of age:
a Lyft promo from 2020 and one from this week looked the same. This module
extracts an expiration signal from the caption (an explicit date, a weekday
cutoff, "24 hours only", a date range, or "every month"/"ongoing" for
recurring offers), anchored to the POST's own date (not today) since a
caption written in September saying "Saturday only" means the Saturday near
that post, not near whenever filter_deals.py happens to run.

Three outcomes per deal:
  active   - still running (explicit end date in the future, evergreen
             language, or just recent enough with no expiration language)
  expired  - an explicit end date/range/weekday has clearly passed
  unclear  - no expiration language found and the post is old enough
             (AGE_THRESHOLD_DAYS) that it's worth a human double-checking

Regex/date parsing alone can't read "Through 9/21" as reliably as an LLM
can when phrasing is unusual, so `unclear` results additionally get one
OpenAI call (only when OPENAI_API_KEY is set) to make the final judgment
-- controlling cost by only spending it on the genuinely ambiguous cases,
not every deal.
"""
import json
import os
import re
from datetime import date as dt_date, datetime, timedelta, timezone

from dateutil import parser as date_parser

import config

AGE_THRESHOLD_DAYS = 45

MONTHS_PAT = (
    r"jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
    r"aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?"
)
MONTHS_MAP = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}
WEEKDAYS_PAT = r"monday|tuesday|wednesday|thursday|friday|saturday|sunday"
WEEKDAYS_MAP = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
                "friday": 4, "saturday": 5, "sunday": 6}

EVERGREEN_RE = re.compile(
    r"\b(every\s+month|monthly|every\s+semester|all\s+semester|ongoing|"
    r"year[- ]round|each\s+month|every\s+week|no\s+expiration|every\s+year|recurring)\b",
    re.I,
)

DATE_RANGE_RE = re.compile(
    rf"\b({MONTHS_PAT})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?\s*[-–—]\s*(\d{{1,2}})(?:st|nd|rd|th)?"
    rf"(?:,?\s*(\d{{4}}))?\b",
    re.I,
)

KEYWORD_DATE_RE = re.compile(
    rf"\b(?:through|thru|until|til|expires?|closes?|ends?|deadline|last\s+day|final\s+day|"
    rf"valid\s+thru|valid\s+through|good\s+through)\s*[:\-]?\s*"
    rf"(?:({MONTHS_PAT})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s*(\d{{4}}))?"
    rf"|(\d{{1,2}})/(\d{{1,2}})(?:/(\d{{2,4}}))?)",
    re.I,
)

WEEKDAY_THROUGH_RE = re.compile(rf"\b(?:through|thru|until|til)\s+({WEEKDAYS_PAT})\b", re.I)
WEEKDAY_ONLY_RE = re.compile(rf"\b({WEEKDAYS_PAT})\s+only\b", re.I)
HOURS_ONLY_RE = re.compile(r"\b(\d{1,3})\s*hours?\s+only\b", re.I)
TODAY_ONLY_RE = re.compile(r"\btoday\s+only\b", re.I)
THIS_WEEKEND_RE = re.compile(r"\bthis\s+weekend\b", re.I)
THIS_WEEK_RE = re.compile(r"\bthis\s+week\b", re.I)

ACTIVITY_MODEL = os.environ.get("OPENAI_ACTIVITY_MODEL", "gpt-4o-mini")


def parse_posted(posted_iso):
    if not posted_iso:
        return None
    try:
        dt = date_parser.parse(str(posted_iso))
    except (ValueError, TypeError, OverflowError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def resolve_date(month, day, year, anchor_date):
    """Turn a possibly year-less month/day into a real date, anchored near
    `anchor_date` (the post's own date) -- e.g. a post from November saying
    "closes August 21" means next August, not the one already 3 months gone."""
    if year is None:
        year = anchor_date.year
        try:
            d = dt_date(year, month, day)
        except ValueError:
            return None
        if (anchor_date - d).days > 180:
            year += 1
            try:
                d = dt_date(year, month, day)
            except ValueError:
                return None
        return d
    if year < 100:
        year += 2000
    try:
        return dt_date(year, month, day)
    except ValueError:
        return None


def extract_date_range(caption, anchor_date):
    m = DATE_RANGE_RE.search(caption)
    if not m:
        return None
    month = MONTHS_MAP.get(m.group(1).lower()[:3])
    if not month:
        return None
    year = int(m.group(4)) if m.group(4) else None
    return resolve_date(month, int(m.group(3)), year, anchor_date)


def extract_keyword_date(caption, anchor_date):
    m = KEYWORD_DATE_RE.search(caption)
    if not m:
        return None
    if m.group(1):
        month = MONTHS_MAP.get(m.group(1).lower()[:3])
        year = int(m.group(3)) if m.group(3) else None
        return resolve_date(month, int(m.group(2)), year, anchor_date)
    if m.group(4):
        year = int(m.group(6)) if m.group(6) else None
        return resolve_date(int(m.group(4)), int(m.group(5)), year, anchor_date)
    return None


def extract_weekday_relative(caption, anchor_date):
    m = WEEKDAY_THROUGH_RE.search(caption) or WEEKDAY_ONLY_RE.search(caption)
    if not m:
        return None
    target = WEEKDAYS_MAP[m.group(1).lower()]
    delta = (target - anchor_date.weekday()) % 7
    return anchor_date + timedelta(days=delta)


def extract_relative_shortcut(caption, anchor_date):
    if TODAY_ONLY_RE.search(caption) or HOURS_ONLY_RE.search(caption):
        return anchor_date
    if THIS_WEEKEND_RE.search(caption):
        return anchor_date + timedelta(days=(6 - anchor_date.weekday()) % 7)
    if THIS_WEEK_RE.search(caption):
        return anchor_date + timedelta(days=7)
    return None


def assess_activity_llm(caption, posted_iso, today_iso):
    """Only called on regex-unclear cases, since this costs an API call.
    Falls back to the caller's regex result on any failure (missing key,
    network error, bad JSON) -- never raises."""
    from openai import OpenAI

    client = OpenAI(api_key=config.OPENAI_API_KEY)
    prompt = f"""Today's date is {today_iso}. This Instagram post was made on {posted_iso or "an unknown date"}.

Caption:
\"\"\"{caption}\"\"\"

Judge whether the deal/promo in this caption is still ACTIVE today, or EXPIRED, using any
dates, days of week, or duration language ("through", "this week", "Saturday only", etc).
If the caption gives no way to tell (no dates, no duration, sounds like an ongoing/recurring
offer), say "unclear".

Respond with ONLY compact JSON, no other text:
{{"status": "active" | "expired" | "unclear", "expires_on": "YYYY-MM-DD" or null, "reason": "one short sentence"}}"""
    resp = client.chat.completions.create(
        model=ACTIVITY_MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    data = json.loads(resp.choices[0].message.content)
    status = data.get("status") if data.get("status") in ("active", "expired", "unclear") else "unclear"
    return {"status": status, "expires_on": data.get("expires_on"), "basis": "llm", "note": data.get("reason", "")}


def assess_activity(caption, posted_iso, now=None):
    """Returns {status: active|expired|unclear, expires_on, basis, note}."""
    now = now or datetime.now(timezone.utc)
    caption = caption or ""
    posted = parse_posted(posted_iso)
    anchor_date = (posted or now).date()

    if EVERGREEN_RE.search(caption):
        return {"status": "active", "expires_on": None, "basis": "evergreen",
                "note": "reads as a recurring/ongoing offer"}

    end = extract_date_range(caption, anchor_date)
    basis = "date_range"
    if not end:
        end = extract_keyword_date(caption, anchor_date)
        basis = "explicit_date"
    if not end:
        end = extract_weekday_relative(caption, anchor_date)
        basis = "weekday"
    if not end:
        end = extract_relative_shortcut(caption, anchor_date)
        basis = "relative"

    if end:
        expired = end < now.date()
        return {"status": "expired" if expired else "active", "expires_on": end.isoformat(),
                "basis": basis, "note": f"caption implies it runs through {end.isoformat()}"}

    if posted is None:
        result = {"status": "unclear", "expires_on": None, "basis": "none",
                  "note": "no post date and no expiration language found"}
    else:
        age_days = (now - posted).days
        if age_days > AGE_THRESHOLD_DAYS:
            result = {"status": "unclear", "expires_on": None, "basis": "age_heuristic",
                      "note": f"posted {age_days} days ago with no expiration language -- verify it's still running"}
        else:
            result = {"status": "active", "expires_on": None, "basis": "none",
                      "note": "recent post, no expiration language found"}

    if result["status"] == "unclear" and config.OPENAI_API_KEY:
        try:
            return assess_activity_llm(caption, posted.isoformat() if posted else None, now.date().isoformat())
        except Exception:
            pass
    return result
