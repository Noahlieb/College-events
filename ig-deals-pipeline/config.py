"""
Central config for the IG deals pipeline: campus branding, deal-account handles,
and discovery search queries. Edit CAMPUS below to add handles / tune queries.
Nothing here is a secret — API keys live in .env, never in this file.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

DATA_DIR = BASE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
STATE_DIR = BASE_DIR / "state"
OUTPUT_DIR = BASE_DIR / "output"
ASSETS_DIR = BASE_DIR / "assets"
FONTS_DIR = ASSETS_DIR / "fonts"
LOGOS_DIR = ASSETS_DIR / "logos"

for d in (RAW_DIR, STATE_DIR, OUTPUT_DIR, FONTS_DIR, LOGOS_DIR):
    d.mkdir(parents=True, exist_ok=True)

DEALS_CLEAN_JSON = DATA_DIR / "deals_clean.json"
DEALS_REVIEW_JS = DATA_DIR / "deals_data.js"
SEEN_STORE = STATE_DIR / "seen_posts.json"
APPROVED_DEALS_JSON = BASE_DIR / "approved_deals.json"

APIFY_TOKEN = os.environ.get("APIFY_TOKEN", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

DISCOVERY_ACTOR = "data-slayer/instagram-keyword-posts-scraper"
MONITOR_ACTOR = "apify/instagram-scraper"
MONITOR_LOOKBACK = os.environ.get("MONITOR_LOOKBACK", "2 days")

# Per-campus branding (used by the flyer generator + approval dashboard) and
# scrape targeting (used by scrape.py + filter_deals.py).
#
# `deal_accounts`: known Instagram accounts that post deals for this campus.
#   Fill these in — only FAU is populated from what you gave me.
# `search_queries`: keyword searches Stage 1 discovery runs to find NEW
#   deal-posting accounts you don't already follow.
# `location_terms` / `campus_patterns`: used by the campus router + noise
#   filter to confirm a post is actually about *this* Florida school.
CAMPUS = {
    "FAU": {
        "name": "Florida Atlantic University",
        "team": "Owls",
        "colors": "navy blue and red",
        "bg": "#0b2c63",
        "accent": "#c8102e",
        "mascot": "a fierce owl",
        "emoji": "🦉",
        "chant": "Go Owls",
        "label": "FAU DEALS",
        "campus_patterns": [r"\bfau\b", r"florida atlantic", r"\bowls\b", r"boca raton", r"\bboca\b"],
        "location_terms": ["boca raton", "boca", "florida"],
        "deal_accounts": ["fau.events", "fau_owlperks", "faudining", "sgatfau"],
        "search_queries": ["FAU student discount", "FAU students deal", "FAU student deal Boca Raton"],
    },
    "FIU": {
        "name": "Florida International University",
        "team": "Panthers",
        "colors": "navy blue and gold",
        "bg": "#081e3f",
        "accent": "#b6862c",
        "mascot": "a panther",
        "emoji": "🐾",
        "chant": "Go Panthers",
        "label": "FIU DEALS",
        "campus_patterns": [r"\bfiu\b", r"florida international", r"\bpanthers\b"],
        "location_terms": ["miami", "florida", "sweetwater"],
        "deal_accounts": [],  # TODO: add FIU deal-account handles
        "search_queries": ["FIU student discount", "FIU students deal", "FIU student deal Miami"],
    },
    "FSU": {
        "name": "Florida State University",
        "team": "Seminoles",
        "colors": "garnet and gold",
        "bg": "#782f40",
        "accent": "#ceb888",
        "mascot": "a spear",
        "emoji": "🏹",
        "chant": "Go Noles",
        "label": "FSU DEALS",
        "campus_patterns": [r"\bfsu\b", r"florida state", r"\bseminoles\b", r"\bnoles\b", r"tallahassee"],
        "location_terms": ["tallahassee", "florida"],
        "deal_accounts": [],  # TODO: add FSU deal-account handles
        "search_queries": ["FSU student discount", "FSU students deal", "FSU student deal Tallahassee"],
    },
    "UCF": {
        "name": "University of Central Florida",
        "team": "Knights",
        "colors": "black and gold",
        "bg": "#111111",
        "accent": "#ffc904",
        "mascot": "a knight",
        "emoji": "⚔️",
        "chant": "Charge On",
        "label": "UCF DEALS",
        "campus_patterns": [r"\bucf\b", r"central florida", r"\bknights\b", r"orlando"],
        "location_terms": ["orlando", "florida"],
        "deal_accounts": [],  # TODO: add UCF deal-account handles
        "search_queries": ["UCF student discount", "UCF students deal", "UCF student deal Orlando"],
    },
    "USF": {
        "name": "University of South Florida",
        "team": "Bulls",
        "colors": "green and gold",
        "bg": "#004727",
        "accent": "#cfc493",
        "mascot": "a charging bull",
        "emoji": "🐂",
        "chant": "Go Bulls",
        "label": "USF DEALS",
        "campus_patterns": [r"\busf\b", r"south florida", r"\bbulls\b", r"tampa"],
        "location_terms": ["tampa", "florida"],
        "deal_accounts": [],  # TODO: add USF deal-account handles
        "search_queries": ["USF student discount", "USF students deal", "USF student deal Tampa"],
    },
    "UM": {
        "name": "University of Miami",
        "team": "Hurricanes",
        "colors": "orange, green and white",
        "bg": "#003b2f",
        "accent": "#f47321",
        "mascot": "an ibis",
        "emoji": "🌀",
        "chant": "Go Canes",
        "label": "UM DEALS",
        "campus_patterns": [r"\bum\b", r"university of miami", r"\bhurricanes\b", r"\bcanes\b", r"coral gables"],
        "location_terms": ["coral gables", "miami", "florida"],
        "deal_accounts": [],  # TODO: add University of Miami deal-account handles
        "search_queries": ["University of Miami student discount", "UM Hurricanes student deal Coral Gables"],
    },
}

# Reverse map built from `deal_accounts` above: known-account -> campus.
# Used as a fallback when a caption doesn't name the school explicitly.
ACCOUNT_CAMPUS = {
    account.lower(): campus
    for campus, cfg in CAMPUS.items()
    for account in cfg["deal_accounts"]
}


def missing_handles():
    """Campuses that still need deal-account handles filled in."""
    return [c for c, cfg in CAMPUS.items() if not cfg["deal_accounts"]]
