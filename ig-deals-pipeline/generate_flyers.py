#!/usr/bin/env python3
"""
generate_flyers.py — Stage 4: turn approved deals into finished Instagram flyers.

COMPOSITE approach (per the text-accuracy caveat in the original script): image
models garble prices/codes, so this never asks the model to render deal text.
Instead:
  1. OpenAI (gpt-image-1) generates ONLY the background artwork — campus-colored,
     mascot/confetti/brush-stroke style, explicitly no lettering, with a prompt
     that reserves clean space for the text overlay.
  2. Pillow draws the exact hero/business/detail/code/handle text on top as a
     crisp layer, so prices and promo codes are always pixel-correct.
  3. A short LLM call (or a template fallback — see below) writes the caption:
     hook + deal details + code + hashtags + a "send this to your group chat" CTA.

If OPENAI_API_KEY is not set, this still runs end-to-end: background art falls
back to a solid campus-brand gradient (no API call) and captions fall back to a
template, so you can test the Pillow compositing/text-layout logic for free
before spending API credits. Once OPENAI_API_KEY is set, both automatically
switch to the real model.

    pip install -r requirements.txt
    python generate_flyers.py approved_deals.json

Output: output/<CAMPUS>/<business>.png + output/<CAMPUS>/<business>.txt (caption)
Also cached: flyers/<CAMPUS>/<business>_bg.png (raw AI background, for reuse/debugging)

API note: image/chat API params (model name, size, quality) change often.
OPENAI_IMAGE_MODEL / OPENAI_CAPTION_MODEL env vars let you bump them without
editing code — verify against current OpenAI docs before a big run.
"""
import argparse
import base64
import json
import os
import re
import sys
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

import config

FLYERS_CACHE = config.BASE_DIR / "flyers"
FLYERS_CACHE.mkdir(exist_ok=True)

# Final Instagram portrait size. Generated at 1024x1536 (closest gpt-image-1
# portrait size) and center-cropped to the exact 1080x1350 (4:5) IG spec.
FINAL_W, FINAL_H = 1080, 1350
GEN_SIZE = "1024x1536"

IMAGE_MODEL = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-1")
CAPTION_MODEL = os.environ.get("OPENAI_CAPTION_MODEL", "gpt-4o-mini")

_client = None


def client():
    global _client
    if _client is None:
        from openai import OpenAI
        _client = OpenAI(api_key=config.OPENAI_API_KEY)
    return _client


def slug(text):
    return re.sub(r"[^a-z0-9]+", "_", (text or "deal").lower()).strip("_") or "deal"


# ---------------------------------------------------------------------------
# STEP 1 — background artwork (AI, or a free placeholder gradient without a key)
# ---------------------------------------------------------------------------
def build_background_prompt(deal):
    c = config.CAMPUS.get(deal["campus"], config.CAMPUS["FAU"])
    photo = deal.get("subject", deal.get("business", "the featured item"))
    return f"""A vibrant, professional Instagram-flyer BACKGROUND (portrait, 4:5) for a
student-deal post at {c['name']} ({c['team']}).

STYLE: energetic, modern campus-marketing graphic — like a high-end sports/food
promo. Bold 3D block-lettering-style shapes (but NO actual letters or words),
confetti/sprinkle scatter, brush-stroke banners, starburst callout shapes.
School colors: {c['colors']}. Include a subtle {c['mascot']} motif worked into
the design. Clean, uncluttered, high contrast, scroll-stopping.

HERO VISUAL: a photorealistic, appetizing/eye-catching shot of {photo}, composited
into the design as a visual centerpiece, offset toward the upper-to-middle area
of the frame.

CRITICAL — THIS IS ARTWORK ONLY, NOT A FINISHED FLYER:
- Do NOT render any text, words, numbers, letters, prices, or logos anywhere in
  the image. No lorem ipsum, no placeholder text, no gibberish text.
- Leave the bottom third of the frame as relatively clean, lower-detail
  negative space (a soft gradient or open background) — real text will be
  overlaid on top of it afterward, so it must stay legible under white text.
"""


def generate_ai_background(deal):
    prompt = build_background_prompt(deal)
    resp = client().images.generate(
        model=IMAGE_MODEL,
        prompt=prompt,
        size=GEN_SIZE,
        quality="high",
        n=1,
    )
    img_bytes = base64.b64decode(resp.data[0].b64_json)
    from io import BytesIO
    return Image.open(BytesIO(img_bytes)).convert("RGB")


def generate_placeholder_background(deal):
    """No-API-key fallback: a campus-brand gradient + diagonal accent band,
    echoing the approval dashboard's preview look. Lets Stage 4's Pillow
    text-overlay logic be tested for free before you add OPENAI_API_KEY."""
    c = config.CAMPUS.get(deal["campus"], config.CAMPUS["FAU"])
    w, h = 1024, 1536
    bg = tuple(int(c["bg"].lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    accent = tuple(int(c["accent"].lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    img = Image.new("RGB", (w, h), bg)
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.polygon([(w * 0.55, 0), (w, 0), (w, h), (w * 0.2, h)], fill=accent + (40,))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    return img


def get_background(deal, force_placeholder=False):
    cache_dir = FLYERS_CACHE / deal["campus"]
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{slug(deal['business'])}_bg.png"
    if not config.OPENAI_API_KEY or force_placeholder:
        print(f"    (no OPENAI_API_KEY — using placeholder background for {deal['business']})")
        img = generate_placeholder_background(deal)
    else:
        img = generate_ai_background(deal)
    img.save(cache_path)
    return img


# ---------------------------------------------------------------------------
# STEP 2 — Pillow text overlay (always exact, never AI-generated)
# ---------------------------------------------------------------------------
def load_font(names, size):
    for name in names:
        for base in (config.FONTS_DIR, Path("/usr/share/fonts/truetype/dejavu")):
            p = base / name
            if p.exists():
                try:
                    return ImageFont.truetype(str(p), size)
                except OSError:
                    continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def fonts(size_hero, size_biz, size_detail, size_code, size_small):
    # Drop matching .ttf files into assets/fonts/ (e.g. Anton-Regular.ttf,
    # Inter-Bold.ttf, Inter-Regular.ttf) to match the approval dashboard's
    # look exactly. Falls back to DejaVu Sans Bold, which is legible but
    # generic, if those aren't present.
    hero = load_font(["Anton-Regular.ttf", "Anton.ttf", "Inter-Black.ttf", "Inter-ExtraBold.ttf",
                       "DejaVuSans-Bold.ttf"], size_hero)
    biz = load_font(["Inter-ExtraBold.ttf", "Inter-Bold.ttf", "DejaVuSans-Bold.ttf"], size_biz)
    detail = load_font(["Inter-SemiBold.ttf", "Inter-Regular.ttf", "DejaVuSans.ttf"], size_detail)
    code = load_font(["Anton-Regular.ttf", "Anton.ttf", "Inter-Black.ttf", "DejaVuSans-Bold.ttf"], size_code)
    small = load_font(["Inter-ExtraBold.ttf", "Inter-Bold.ttf", "DejaVuSans-Bold.ttf"], size_small)
    return hero, biz, detail, code, small


def wrap_to_width(draw, text, font, max_width):
    if not text:
        return []
    words = text.split()
    lines, cur = [], ""
    for word in words:
        trial = f"{cur} {word}".strip()
        if draw.textlength(trial, font=font) <= max_width or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def shrink_to_fit(draw, text, load_size_font, max_width, min_size=48, start_size=200):
    """Reduce font size until `text` fits on one line within max_width."""
    size = start_size
    while size > min_size:
        font = load_size_font(size)
        if draw.textlength(text, font=font) <= max_width:
            return font, size
        size -= 8
    return load_size_font(min_size), min_size


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def compose_flyer(deal, background):
    c = config.CAMPUS.get(deal["campus"], config.CAMPUS["FAU"])
    accent = hex_to_rgb(c["accent"])

    # center-crop the generated portrait to the exact IG 4:5 spec
    bw, bh = background.size
    target_ratio = FINAL_W / FINAL_H
    if bw / bh > target_ratio:
        new_w = int(bh * target_ratio)
        left = (bw - new_w) // 2
        background = background.crop((left, 0, left + new_w, bh))
    else:
        new_h = int(bw / target_ratio)
        top = (bh - new_h) // 2
        background = background.crop((0, top, bw, top + new_h))
    img = background.resize((FINAL_W, FINAL_H), Image.LANCZOS).convert("RGBA")

    # dark gradient scrim over the bottom ~60% so white text stays legible
    # over whatever the AI background happens to put there
    scrim = Image.new("L", (1, FINAL_H), 0)
    for y in range(FINAL_H):
        t = max(0, (y - FINAL_H * 0.35) / (FINAL_H * 0.65))
        scrim.putpixel((0, y), int(190 * min(1, t)))
    scrim = scrim.resize((FINAL_W, FINAL_H))
    black = Image.new("RGBA", (FINAL_W, FINAL_H), (0, 0, 0, 255))
    black.putalpha(scrim)
    img = Image.alpha_composite(img, black)

    draw = ImageDraw.Draw(img)
    pad = 64
    hero_f, biz_f, detail_f, code_f, small_f = fonts(160, 46, 34, 44, 26)

    # top badge: campus dot + label (mascot emoji dropped here — DejaVu/Anton
    # can't rasterize color emoji and it renders as a tofu box; the caption
    # text still carries emoji, where Instagram itself renders them), handle
    # on the right
    draw.ellipse((pad, pad + 6, pad + 20, pad + 26), fill=accent)
    draw.text((pad + 30, pad), c["label"], font=small_f, fill="white")
    if deal.get("handle"):
        hw = draw.textlength(deal["handle"], font=small_f)
        draw.text((FINAL_W - pad - hw, pad), deal["handle"], font=small_f, fill=(255, 255, 255, 220))

    # business/hero/detail/code block, anchored well above the bottom CTA
    # strip with a fixed budget so long captions can never collide with it
    y = FINAL_H - 650
    draw.text((pad, y), deal.get("business", ""), font=biz_f, fill="white")
    y += 58

    # hero offer, shrink-to-fit within the flyer width (and a modest max
    # start size so a short hero like "BOGO" can't blow the height budget)
    hero_text = (deal.get("hero") or "DEAL").upper()
    hero_font, _ = shrink_to_fit(
        draw, hero_text, lambda s: fonts(s, 46, 34, 44, 26)[0], FINAL_W - pad * 2, min_size=60, start_size=140
    )
    draw.text((pad, y), hero_text, font=hero_font, fill=accent)
    bbox = draw.textbbox((pad, y), hero_text, font=hero_font)
    y = bbox[3] + 20

    # detail line, wrapped, capped at 2 lines to protect the layout budget
    for line in wrap_to_width(draw, deal.get("detail", ""), detail_f, FINAL_W - pad * 2)[:2]:
        draw.text((pad, y), line, font=detail_f, fill=(255, 255, 255, 235))
        y += 40

    y += 14
    x = pad
    if deal.get("code"):
        label = "CODE"
        code_text = deal["code"]
        lw = draw.textlength(label, font=small_f)
        cw = draw.textlength(code_text, font=code_f)
        box_w = int(lw + cw + 60)
        box_h = 70
        draw.rounded_rectangle((x, y, x + box_w, y + box_h), radius=14, fill="white")
        draw.text((x + 20, y + box_h / 2 - 10), label, font=small_f, fill=(20, 20, 20))
        draw.text((x + 30 + lw, y + box_h / 2 - code_f.size / 2 - 4), code_text, font=code_f, fill=(20, 20, 20))
        x += box_w + 24

    if deal.get("meta"):
        draw.text((x, y + 18), deal["meta"], font=detail_f, fill=(255, 255, 255, 210))

    # bottom CTA strip
    strip_h = 90
    draw.rectangle((0, FINAL_H - strip_h, FINAL_W, FINAL_H), fill=accent)
    cta = "SEND THIS TO YOUR GROUP CHAT"
    cta_font, _ = shrink_to_fit(draw, cta, lambda s: fonts(46, 46, 34, 44, s)[4], FINAL_W - pad * 2,
                                 min_size=20, start_size=32)
    cw = draw.textlength(cta, font=cta_font)
    draw.text(((FINAL_W - cw) / 2, FINAL_H - strip_h / 2 - cta_font.size / 2), cta, font=cta_font, fill="white")

    logo_path = config.LOGOS_DIR / f"{deal['campus']}.png"
    if logo_path.exists():
        logo = Image.open(logo_path).convert("RGBA")
        logo.thumbnail((110, 110))
        img.alpha_composite(logo, (FINAL_W - pad - logo.width, FINAL_H - strip_h - logo.height - 20))

    return img.convert("RGB")


# ---------------------------------------------------------------------------
# STEP 3 — caption (LLM, or a template fallback without a key)
# ---------------------------------------------------------------------------
HASHTAG_BASE = {
    "FAU": ["#FAU", "#FloridaAtlantic", "#GoOwls", "#BocaRaton"],
    "FIU": ["#FIU", "#FloridaInternational", "#GoPanthers", "#Miami"],
    "FSU": ["#FSU", "#FloridaState", "#GoNoles", "#Tallahassee"],
    "UCF": ["#UCF", "#CentralFlorida", "#ChargeOn", "#Orlando"],
    "USF": ["#USF", "#SouthFlorida", "#GoBulls", "#Tampa"],
    "UM": ["#UMiami", "#Hurricanes", "#GoCanes", "#CoralGables"],
}


def template_caption(deal):
    c = config.CAMPUS.get(deal["campus"], config.CAMPUS["FAU"])
    lines = [f"{deal.get('hero','DEAL')} at {deal.get('business','')} 👀"]
    if deal.get("detail"):
        lines.append(deal["detail"])
    if deal.get("code"):
        lines.append(f"Use code {deal['code']} 🔑")
    if deal.get("meta"):
        lines.append(deal["meta"])
    lines.append(f"{c['chant']} — send this to your group chat 📲")
    tags = " ".join(HASHTAG_BASE.get(deal["campus"], ["#StudentDeals"]) + ["#StudentDeal", "#CollegeDeals"])
    lines.append(tags)
    return "\n\n".join(lines)


def ai_caption(deal):
    c = config.CAMPUS.get(deal["campus"], config.CAMPUS["FAU"])
    tags = " ".join(HASHTAG_BASE.get(deal["campus"], ["#StudentDeals"]) + ["#StudentDeal", "#CollegeDeals"])
    prompt = f"""Write an Instagram caption for a college student-deals account at {c['name']} ({c['team']}).

Deal: {deal.get('hero','')} at {deal.get('business','')}
Details: {deal.get('detail','')}
{f"Code: {deal['code']}" if deal.get('code') else ''}
{f"Extra info: {deal['meta']}" if deal.get('meta') else ''}

Structure: a scroll-stopping one-line hook, then the deal details, then the
promo code if there is one (call it out clearly, spelled exactly as given),
then a "send this to your group chat" style call-to-action, then end with
these hashtags exactly: {tags}
Tone: hype, casual, emoji-friendly, short lines. No markdown formatting."""
    resp = client().chat.completions.create(
        model=CAPTION_MODEL,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.choices[0].message.content.strip()


def get_caption(deal):
    if not config.OPENAI_API_KEY:
        return template_caption(deal)
    try:
        return ai_caption(deal)
    except Exception as e:
        print(f"    !! caption API failed ({e}), using template caption instead")
        return template_caption(deal)


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------
def process_deal(deal, force_placeholder=False):
    campus = deal.get("campus", "UNMATCHED")
    out_dir = config.OUTPUT_DIR / campus
    out_dir.mkdir(parents=True, exist_ok=True)
    name = slug(deal.get("business", deal.get("id", "deal")))

    bg = get_background(deal, force_placeholder=force_placeholder)
    flyer = compose_flyer(deal, bg)
    img_path = out_dir / f"{name}.png"
    flyer.save(img_path)

    caption = get_caption(deal)
    caption_path = out_dir / f"{name}.txt"
    caption_path.write_text(caption)

    return img_path, caption_path


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", nargs="?", default=str(config.APPROVED_DEALS_JSON))
    ap.add_argument("--placeholder-art", action="store_true",
                     help="force the free gradient background even if OPENAI_API_KEY is set (fast local testing)")
    args = ap.parse_args()

    src = Path(args.src)
    if not src.exists():
        sys.exit(f"no input at {src} — export approved_deals.json from deal_approval.html first.")

    deals = json.loads(src.read_text())
    if isinstance(deals, dict):
        deals = deals.get("deals", deals.get("items", []))

    if not config.OPENAI_API_KEY:
        print("note: OPENAI_API_KEY not set — generating placeholder backgrounds + template captions.\n"
              "      Add it to .env for real AI artwork + LLM captions.\n")

    print(f"generating {len(deals)} flyers...")
    for i, d in enumerate(deals, 1):
        try:
            img_path, caption_path = process_deal(d, force_placeholder=args.placeholder_art)
            print(f"  [{i}/{len(deals)}] {d['campus']:4} {d['business'][:30]:30} -> {img_path}")
        except Exception as e:
            print(f"  [{i}/{len(deals)}] FAILED {d.get('business','?')}: {e}")

    print(f"\ndone. See {config.OUTPUT_DIR}/<campus>/ for images + captions.")
    print("Posting is a TODO — wire up Buffer/Later/Metricool or the Instagram Graph API next.")


if __name__ == "__main__":
    main()
