#!/usr/bin/env python3
"""
server.py — tiny local Flask server for the "Generate flyer options" button
in deal_approval.html.

Why this exists: deal_approval.html is a static page you can open directly
via file:// for approving/skipping deals (Stages 3), but generating AI
flyers needs OPENAI_API_KEY, and a static file:// page can't call the
OpenAI API from browser JS without exposing that key to anyone who views
the page source. This server keeps the key server-side: the dashboard's
JS calls same-origin fetch('/api/generate') / fetch('/api/save'), and this
process is the only thing that ever touches config.OPENAI_API_KEY.

    pip install -r requirements.txt
    python3 server.py
    # open http://localhost:5000/ instead of double-clicking the html file

Everything else (approve/skip, export, filters) still works exactly the
same as opening the file directly — only the new Generate button needs the
server running.
"""
import base64
import traceback

from flask import Flask, jsonify, request, send_from_directory

import config
import generate_flyers

app = Flask(__name__, static_folder=None)


@app.route("/")
def index():
    return send_from_directory(str(config.BASE_DIR), "deal_approval.html")


@app.route("/data/<path:filename>")
def data_files(filename):
    return send_from_directory(str(config.DATA_DIR), filename)


@app.route("/assets/<path:filename>")
def asset_files(filename):
    return send_from_directory(str(config.ASSETS_DIR), filename)


@app.route("/api/generate", methods=["POST"])
def api_generate():
    deal = request.get_json(force=True, silent=True) or {}
    if not deal.get("business") and not deal.get("hero"):
        return jsonify({"error": "missing deal fields"}), 400
    try:
        options = generate_flyers.generate_flyer_options(deal, n_options=5)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    return jsonify({"options": options, "used_ai": bool(config.OPENAI_API_KEY)})


@app.route("/api/save", methods=["POST"])
def api_save():
    body = request.get_json(force=True, silent=True) or {}
    deal = body.get("deal") or {}
    image_b64 = body.get("image_b64")
    caption = body.get("caption", "")
    if not image_b64:
        return jsonify({"error": "missing image_b64"}), 400

    campus = deal.get("campus", "UNMATCHED")
    out_dir = config.OUTPUT_DIR / campus
    out_dir.mkdir(parents=True, exist_ok=True)
    name = generate_flyers.slug(deal.get("business", deal.get("id", "deal")))

    img_path = out_dir / f"{name}.png"
    img_path.write_bytes(base64.b64decode(image_b64))
    caption_path = out_dir / f"{name}.txt"
    caption_path.write_text(caption)

    return jsonify({"saved": True, "image_path": str(img_path), "caption_path": str(caption_path)})


if __name__ == "__main__":
    if not config.OPENAI_API_KEY:
        print("note: OPENAI_API_KEY not set — /api/generate will return placeholder-composite "
              "options instead of real AI flyers. Add it to .env for the real thing.\n")
    print(f"Serving the dashboard at http://localhost:5000/  (Ctrl+C to stop)")
    app.run(host="127.0.0.1", port=5000, debug=False)
