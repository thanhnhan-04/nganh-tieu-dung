#!/usr/bin/env python3
"""Fetch live quotes/commodities and write a static live-data.json snapshot.

Used by the GitHub Actions workflow (.github/workflows/refresh-live-data.yml)
to refresh the "live" data consumed by the static GitHub Pages site, since
Pages cannot run server.py's /api/live endpoint on demand.
"""
from __future__ import annotations

import json
from pathlib import Path

from server import live_payload

ROOT = Path(__file__).resolve().parent

if __name__ == "__main__":
    data = live_payload()
    out = ROOT / "live-data.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {out} — generatedAt={data.get('generatedAt')}")
