#!/usr/bin/env python3
"""
filter_deals.py — Stage 2: score raw Apify posts, keep real deals, extract
structured fields, route to a campus, dedup, and filter out noise.

Adapted from the original ig_deals_filter.py. Same scoring/extraction/dedup
core, plus:
  - German-university / non-Florida noise filtering (e.g. "FAU" hitting
    Friedrich-Alexander-Universität Erlangen-Nürnberg instead of Florida
    Atlantic University).
  - Wrong-campus-for-query filtering, using the `_campus_queried` tag
    scrape.py stamps on every raw item.
  - Dashboard-ready fields (hero/detail/meta/handle) so Stage 3's approval
    dashboard and Stage 4's flyer generator don't need their own parsing.
  - Activity status (activity.py): every kept deal gets tagged active/
    expired/unclear from an explicit date/weekday/duration in the caption
    (or an LLM judgment call for genuinely ambiguous ones), so a 2020 Uber
    promo and this week's BOGO don't look equally trustworthy.

Usage:
    python filter_deals.py                     # reads data/raw/*_<today>.json (all campuses scraped today)
    python filter_deals.py path/to/raw.json     # or any single Apify export

Outputs:
    data/deals_clean.json   # {"generated_at", "by_campus", "deals": [...]}
    data/deals_clean.csv    # same, flat
    data/deals_data.js      # `const DEALS = [...]` for deal_approval.html
    state/seen_posts.json   # persistent dedup store — don't delete this
"""
import csv
import hashlib
import json
import re
import sys
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path

import activity
import config

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------
MIN_DEAL_SCORE = 0  # sum of matched signal weights required to keep a post
# Kept at 0 on purpose: this is a search-results triage tool, not an
# auto-reject filter. Pull every post the search/monitor actors return
# (minus genuine wrong-school noise below) and let human review in the
# dashboard be the actual deal/not-deal decision -- an aggressive score
# threshold was silently dropping real deals before they were ever seen.

DEAL_SIGNALS = [
    (re.compile(r"\b\d{1,3}\s?%\s?off\b", re.I), 3),
    (re.compile(r"\bbogo\b|\bbuy one[, ]+get one\b", re.I), 3),
    (re.compile(r"\$\d+(?:\.\d{2})?\b"), 2),
    (re.compile(r"\bstudent (?:id|discount|special|deal)\b", re.I), 3),
    (re.compile(r"\b(?:deal|promo|coupon|special)s?\b", re.I), 1),
    (re.compile(r"\bfree\b(?:\W+\w+){0,3}\W+(?:beignet|pizza|doughnut|donut|coffee|food|meal|"
                r"drink|jersey|shirt|merch|swag|gift|entry|cover|slice|taco|burrito|wing|boba|"
                r"tea|smoothie|sample|ticket)s?\b", re.I), 3),
    (re.compile(r"\bfirst\s+\d+\s+(?:students?|customers?|people|fans?)\b", re.I), 2),
    (re.compile(r"\bfree\b", re.I), 1),
    (re.compile(r"\bcode\s*[:\-]?\s*[A-Z0-9]{3,}\b"), 2),
    (re.compile(r"\boff (?:your|the|any)\b", re.I), 1),
]

RE_PERCENT = re.compile(r"(\d{1,3})\s?%\s?off", re.I)
RE_DOLLAR = re.compile(r"\$\d+(?:\.\d{2})?")
RE_ADDRESS = re.compile(
    r"\d{3,6}\s+[NSEW]?\.?\s?[\w.]+(?:\s+\w+){0,3}\s+"
    r"(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|way|ln|lane|hwy|pkwy)\b\.?",
    re.I,
)
RE_CODE = re.compile(r"\bcode\s*[:\-]?\s*([A-Z0-9]{3,})\b")
EMOJI_AND_SYMBOLS = re.compile(r"[^\w\s%$.\-]", re.UNICODE)
RE_URL = re.compile(r"https?://\S+")
RE_HASHTAG = re.compile(r"#\w+")

CAMPUS_PATTERNS = {
    c: [re.compile(p, re.I) for p in cfg["campus_patterns"]] for c, cfg in config.CAMPUS.items()
}

# --- Noise filtering: wrong "FAU" (and friends), non-Florida results -------
GERMAN_UNIVERSITY_TERMS = re.compile(
    r"erlangen|n[üu]rnberg|nuernberg|nurnberg|friedrich[- ]alexander|\bfau\.de\b|fau[- ]erlangen",
    re.I,
)
GERMAN_STOPWORDS = re.compile(
    r"\b(und|der|die|das|ist|nicht|mit|f[üu]r|fuer|auch|sehr|heute|morgen|wir|ihr|sie|kein|keine|"
    r"sch[öo]n|schoen|rabatt|studenten|universit[äa]t|universitaet|willkommen|danke)\b",
    re.I,
)
FLORIDA_HINT = re.compile(
    r"florida|\bfl\b|boca raton|\bboca\b|tampa|orlando|miami|tallahassee|coral gables|"
    r"gainesville|fort lauderdale|sweetwater",
    re.I,
)


def detect_noise(caption, location, hashtag_blob):
    """Return a noise reason string, or None if the post looks legit.

    Note: a post whose content clearly names a DIFFERENT tracked Florida
    campus than the one queried is not noise -- it's a real deal for that
    other campus that a broad keyword search happened to surface. It gets
    routed to the campus its content actually names (see process() below)
    rather than dropped. Only content that isn't about any tracked Florida
    campus at all (the German FAU, or generic off-topic German content) is
    filtered here."""
    blob = f"{caption or ''} {location or ''} {hashtag_blob or ''}"
    if GERMAN_UNIVERSITY_TERMS.search(blob):
        return "german_university"
    german_hits = len(GERMAN_STOPWORDS.findall(blob))
    if german_hits >= 3 and not FLORIDA_HINT.search(blob):
        return "german_language"
    return None


# ---------------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------------
def load_seen():
    if config.SEEN_STORE.exists():
        data = json.loads(config.SEEN_STORE.read_text())
        return set(data.get("ids", [])), set(data.get("signatures", []))
    return set(), set()


def save_seen(ids, signatures):
    config.SEEN_STORE.write_text(json.dumps({"ids": sorted(ids), "signatures": sorted(signatures)}, indent=2))


def get(post, *keys, default=""):
    for k in keys:
        if k in post and post[k] not in (None, ""):
            return post[k]
    return default


def extract_image_url(post):
    """Best-effort image URL, whichever field the actor used. Unverified
    across actors -- same network limitation as the field-name note in
    scrape.py, so if this comes back empty on a real scrape, open
    data/raw/<campus>_<date>.json, find the actual image key on a raw post,
    and add it to the candidate list below."""
    direct = get(post, "displayUrl", "imageUrl", "thumbnailUrl", "thumbnail", "photo", "picture")
    if direct:
        return direct
    for key in ("images", "displayResources", "media"):
        val = post.get(key)
        if isinstance(val, list) and val:
            first = val[0]
            if isinstance(first, str):
                return first
            if isinstance(first, dict):
                url = first.get("url") or first.get("src") or first.get("uri")
                if url:
                    return url
        elif isinstance(val, dict):
            url = val.get("url") or val.get("src") or val.get("uri")
            if url:
                return url
    return ""


def stringify(value):
    """Coerce a post field down to a plain string. Real Apify actor output is
    inconsistent here -- e.g. `location` sometimes comes back as a nested
    object ({"name": "Boca Raton, Florida", "id": ...}) instead of a flat
    string, and `hashtags` sometimes as a list of such objects instead of a
    list of strings. Every downstream text-blob builder assumes plain
    strings, so every raw field is funneled through this first."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return stringify(value.get("name") or value.get("id") or "")
    if isinstance(value, list):
        return " ".join(stringify(v) for v in value if v)
    return str(value)


def normalize(text):
    text = unicodedata.normalize("NFKD", text or "")
    text = EMOJI_AND_SYMBOLS.sub(" ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def deal_score(caption):
    return sum(w for pat, w in DEAL_SIGNALS if pat.search(caption or ""))


def detect_campus_by_content(*texts):
    blob = " ".join(t for t in texts if t)
    for campus, patterns in CAMPUS_PATTERNS.items():
        if any(p.search(blob) for p in patterns):
            return campus
    return "UNMATCHED"


def extract_discount(caption):
    pct = RE_PERCENT.search(caption or "")
    if pct:
        return f"{pct.group(1)}% off"
    dol = RE_DOLLAR.search(caption or "")
    if dol:
        return dol.group(0)
    if re.search(r"\bbogo\b|buy one", caption or "", re.I):
        return "BOGO"
    if re.search(r"\bfree\b", caption or "", re.I):
        return "free item"
    return ""


def humanize_hero(discount):
    if not discount:
        return "DEAL"
    if discount == "free item":
        return "FREE"
    return discount.upper()


def clean_detail(caption):
    text = RE_URL.sub("", caption or "")
    text = RE_HASHTAG.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > 110:
        text = text[:107].rsplit(" ", 1)[0].rstrip(",.") + "…"
    return text


RE_BIZ_AT = re.compile(r"\bat\s+([A-Z\[][\w&'.\]\-]*(?:\s+[A-Z][\w&'.\]\-]*){0,3})")
RE_BIZ_LEAD = re.compile(r"^([A-Z\[][\w&'.\]\-]*(?:\s+[A-Z][\w&'.\]\-]*){0,3})\s*[:\-–]")


def extract_business(caption, fallback):
    """Best-effort merchant name from the caption text ('20% off at X', 'X: deal...'),
    falling back to the posting account's display name. Deliberately caption-first:
    the same deal reposted by a different account still resolves to the same
    business name, which is what makes cross-account dedup below actually work."""
    caption = caption or ""
    m = RE_BIZ_AT.search(caption)
    if m and len(m.group(1)) > 2:
        return m.group(1).strip().rstrip(".,!")
    m = RE_BIZ_LEAD.match(caption.strip())
    if m and len(m.group(1)) > 2:
        return m.group(1).strip()
    return fallback


def signature(campus, caption):
    """Campus + first ~10 normalized caption words. Same deal, any account,
    any post id -> same signature, which is what catches cross-account reposts.
    Kept short on purpose: the deal-identifying words (offer type, business
    name) cluster at the start of these captions, and reposts commonly rewrite
    everything after that opening."""
    words = normalize(caption).split()[:10]
    return f"{campus}::{' '.join(words)}"


def make_id(pid, shortcode, business, caption):
    if pid:
        return str(pid)
    if shortcode:
        return str(shortcode)
    return hashlib.sha1(f"{business}{caption}".encode("utf-8")).hexdigest()[:12]


# ---------------------------------------------------------------------------
# PIPELINE
# ---------------------------------------------------------------------------
def process(posts):
    seen_ids, seen_sigs = load_seen()
    kept, skipped_dupe, skipped_weak, skipped_empty = [], 0, 0, 0
    skipped_noise = {}

    for post in posts:
        pid = str(get(post, "id", "postId", "pk", default=""))
        shortcode = get(post, "shortCode", "shortcode", "code")
        caption = stringify(get(post, "caption", "text", "captionText"))
        location = stringify(get(post, "locationName", "location"))
        hashtag_blob = stringify(get(post, "hashtags", default=[]))
        source_account = str(get(post, "ownerUsername", "username")).lower()
        queried_campus = post.get("_campus_queried")

        if not caption and not pid and not shortcode:
            # Not a real post -- some actor runs emit an account-level/error
            # item (no id, no shortcode, no caption) instead of skipping a
            # directUrl with nothing new. MIN_DEAL_SCORE=0 means the score
            # gate no longer catches this, since an empty caption scores 0
            # same as a real deal would if scoring were disabled.
            skipped_empty += 1
            continue

        score = deal_score(f"{caption} {hashtag_blob}")
        if score < MIN_DEAL_SCORE:
            skipped_weak += 1
            continue

        detected = detect_campus_by_content(caption, hashtag_blob, location)
        noise = detect_noise(caption, location, hashtag_blob)
        if noise:
            skipped_noise[noise] = skipped_noise.get(noise, 0) + 1
            continue

        campus = detected
        if campus == "UNMATCHED":
            campus = config.ACCOUNT_CAMPUS.get(source_account, "UNMATCHED")
        if campus == "UNMATCHED" and queried_campus:
            campus = queried_campus

        sig = signature(campus, caption)
        if (pid and pid in seen_ids) or sig in seen_sigs:
            skipped_dupe += 1
            continue

        business = extract_business(caption, stringify(get(post, "ownerFullName", "ownerUsername", "username", "owner")))
        addr = RE_ADDRESS.search(caption or "")
        code = RE_CODE.search(caption or "")
        discount = extract_discount(caption)
        rid = make_id(pid, shortcode, business, caption)

        posted = get(post, "timestamp", "takenAt", "postedAt")
        meta = addr.group(0).strip() if addr else (location or (f"Posted {posted}" if posted else ""))
        activity_info = activity.assess_activity(caption, posted)

        record = {
            "id": rid,
            "campus": campus,
            "business": business,
            "hero": humanize_hero(discount),
            "detail": clean_detail(caption),
            "discount": discount,
            "code": code.group(1) if code else "",
            "address": addr.group(0).strip() if addr else "",
            "meta": meta,
            "handle": f"@{source_account}" if source_account and source_account != "none" else "",
            "source_account": source_account,
            "posted": posted,
            "likes": get(post, "likesCount", "likes", default=0),
            "url": get(post, "url", "postUrl") or (f"https://www.instagram.com/p/{shortcode}/" if shortcode else ""),
            "image_url": extract_image_url(post),
            "deal_score": score,
            "caption": (caption or "").strip(),
            "source": post.get("_source", ""),
            "activity_status": activity_info["status"],
            "expires_on": activity_info["expires_on"],
            "activity_note": activity_info["note"],
        }
        kept.append(record)
        if pid:
            seen_ids.add(pid)
        seen_sigs.add(sig)

    save_seen(seen_ids, seen_sigs)
    return kept, skipped_dupe, skipped_weak, skipped_empty, skipped_noise


def load_existing_deals():
    """Whatever the review queue already held before this run. The seen-store
    stops the SAME underlying post from being re-added on a future scrape;
    it's not meant to shrink the queue just because this particular run found
    fewer brand-new posts than a previous one did. Without this merge, running
    filter_deals.py twice in a row (or a cron re-run before you've reviewed
    yesterday's queue) would silently overwrite deals_clean.json/deals_data.js
    with near-nothing, even though nothing was actually wrong."""
    if not config.DEALS_CLEAN_JSON.exists():
        return []
    try:
        return json.loads(config.DEALS_CLEAN_JSON.read_text()).get("deals", [])
    except (json.JSONDecodeError, OSError):
        return []


def write_outputs(records):
    by_id = {r["id"]: r for r in load_existing_deals()}
    by_id.update({r["id"]: r for r in records})
    records = list(by_id.values())

    by_campus = {}
    for r in records:
        by_campus.setdefault(r["campus"], []).append(r)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(records),
        "by_campus": {c: len(v) for c, v in by_campus.items()},
        "deals": records,
    }
    config.DEALS_CLEAN_JSON.write_text(json.dumps(payload, indent=2))

    csv_path = config.DATA_DIR / "deals_clean.csv"
    if records:
        cols = ["id", "campus", "business", "hero", "detail", "discount", "code", "address", "meta",
                "handle", "source_account", "posted", "likes", "url", "image_url", "deal_score", "caption",
                "source", "activity_status", "expires_on", "activity_note"]
        with csv_path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(records)

    # .get() with defaults, not r[k]: a merged-in record from before activity.py
    # existed won't have these keys, and shouldn't crash the whole export over it.
    js_keys = ("id", "campus", "hero", "business", "detail", "meta", "code", "handle", "url", "image_url",
               "caption", "activity_status", "expires_on", "activity_note")
    js_records = [
        {k: r.get(k, "unclear" if k == "activity_status" else None if k == "expires_on" else "") for k in js_keys}
        for r in records
    ]
    # window.DEALS (not `const`) so deal_approval.html can detect a missing/failed
    # load (e.g. before the first pipeline run) instead of throwing a ReferenceError.
    js = "// Auto-generated by filter_deals.py — do not edit by hand.\nwindow.DEALS = " + json.dumps(
        js_records, indent=2
    ) + ";\n"
    config.DEALS_REVIEW_JS.write_text(js)
    return len(records)


def load_posts(src_arg):
    if src_arg:
        srcs = [Path(src_arg)]
        if not srcs[0].exists():
            sys.exit(f"no input at {srcs[0]}")
    else:
        today = date.today().isoformat()
        srcs = sorted(config.RAW_DIR.glob(f"*_{today}.json"))
        if not srcs:
            sys.exit(
                f"no raw files for today ({today}) in {config.RAW_DIR} — "
                f"run scrape.py first, or pass a raw Apify JSON export as an argument."
            )

    posts = []
    for src in srcs:
        raw = json.loads(src.read_text())
        posts += raw if isinstance(raw, list) else raw.get("items", raw.get("results", []))
    return srcs, posts


def main():
    src_arg = sys.argv[1] if len(sys.argv) > 1 else None
    srcs, posts = load_posts(src_arg)

    kept, dupes, weak, empty, noise = process(posts)
    total_queue = write_outputs(kept)

    by_campus = {}
    for r in kept:
        by_campus[r["campus"]] = by_campus.get(r["campus"], 0) + 1

    print(f"read {len(srcs)} file(s): {', '.join(s.name for s in srcs)}")
    print(f"scanned {len(posts)} posts")
    print(f"  kept {len(kept)} new deals this run")
    print(f"  skipped {dupes} duplicates / reposts")
    print(f"  skipped {weak} non-deals (below score threshold)")
    if empty:
        print(f"  skipped {empty} empty/invalid items (no caption, no post id)")
    if noise:
        print(f"  skipped {sum(noise.values())} noise: " + ", ".join(f"{k}={v}" for k, v in sorted(noise.items())))
    if by_campus:
        print("  by campus (new this run): " + ", ".join(f"{k}={v}" for k, v in sorted(by_campus.items())))
    print(f"\n{total_queue} deal(s) total in the review queue (including any from earlier runs "
          f"you haven't approved/skipped yet).")
    print(f"wrote {config.DEALS_CLEAN_JSON}")
    print(f"wrote {config.DEALS_REVIEW_JS}  (open deal_approval.html next)")


if __name__ == "__main__":
    main()
