#!/usr/bin/env python3
from __future__ import annotations

import json
import mimetypes
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = 8765

TICKER_SUFFIXES = {
    "VNM": [".VN"],
    "MCM": [".VN"],
    "SAB": [".VN"],
    "QNS": [".VN", ".HN"]
}

COMMODITIES = {
    "milk": "DC=F",
    "sugar": "SB=F",
    "soybean": "ZS=F",
    "aluminum": "ALI=F",
    "fx": "VND=X"
}


def http_get_json(url: str, timeout: int = 8) -> dict:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 consumer-dashboard/1.0",
            "Accept": "application/json,text/plain,*/*"
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            data = res.read(2_000_000)
    except urllib.error.URLError as exc:
        if "CERTIFICATE_VERIFY_FAILED" not in str(exc):
            raise
        context = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=timeout, context=context) as res:
            data = res.read(2_000_000)
    text = data.decode("utf-8", errors="replace")
    if text.lstrip().startswith("<"):
        raise ValueError("Endpoint returned HTML challenge page")
    return json.loads(text)


def yahoo_chart(symbol: str, range_: str = "1mo", interval: str = "1d") -> dict:
    query = urllib.parse.urlencode({"range": range_, "interval": interval})
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?{query}"
    payload = http_get_json(url)
    result = (payload.get("chart", {}).get("result") or [None])[0]
    if not result:
        err = payload.get("chart", {}).get("error") or {}
        raise ValueError(err.get("description") or "No chart result")

    meta = result.get("meta", {})
    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []
    points = []
    for ts, close, volume in zip(timestamps, closes, volumes):
        if close is None:
            continue
        points.append({
            "date": time.strftime("%Y-%m-%d", time.localtime(ts)),
            "close": round(float(close), 4),
            "volume": int(volume or 0)
        })
    if not points:
        raise ValueError("No valid price points")

    last = points[-1]
    prev_close = meta.get("chartPreviousClose")
    if prev_close is None and len(points) > 1:
        prev_close = points[-2]["close"]
    change = None if prev_close in (None, 0) else last["close"] - float(prev_close)
    change_pct = None if change is None else change / float(prev_close)

    return {
        "symbol": symbol,
        "price": last["close"],
        "change": None if change is None else round(change, 4),
        "changePct": None if change_pct is None else round(change_pct, 6),
        "volume": last["volume"],
        "currency": meta.get("currency"),
        "exchange": meta.get("exchangeName"),
        "timestamp": last["date"],
        "history": points[-30:],
        "source": "Yahoo Finance chart"
    }


def fetch_ticker(symbol: str) -> dict:
    errors = []
    for suffix in TICKER_SUFFIXES.get(symbol, [".VN"]):
        yf_symbol = f"{symbol}{suffix}"
        try:
            data = yahoo_chart(yf_symbol)
            data["ticker"] = symbol
            data["status"] = "live"
            return data
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{yf_symbol}: {exc}")
    return {"ticker": symbol, "status": "offline", "errors": errors}


def fetch_commodity(name: str, yf_symbol: str) -> dict:
    try:
        data = yahoo_chart(yf_symbol, range_="3mo", interval="1d")
        data["id"] = name
        data["status"] = "live"
        return data
    except Exception as exc:  # noqa: BLE001
        return {"id": name, "symbol": yf_symbol, "status": "offline", "errors": [str(exc)]}


def live_payload() -> dict:
    tickers = ["VNM", "MCM", "QNS", "SAB"]
    return {
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S %Z"),
        "quotes": {ticker: fetch_ticker(ticker) for ticker in tickers},
        "commodities": {
            name: fetch_commodity(name, symbol)
            for name, symbol in COMMODITIES.items()
        }
    }


class Handler(BaseHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/live":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps(live_payload(), ensure_ascii=False).encode("utf-8"))
            return

        rel = "index.html" if parsed.path in ("", "/") else parsed.path.lstrip("/")
        target = (ROOT / rel).resolve()
        if ROOT not in target.parents and target != ROOT:
            self.send_error(403)
            return
        if not target.exists() or target.is_dir():
            self.send_error(404)
            return
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("text/") or ctype.endswith("javascript") or ctype.endswith("json") else ""))
        self.end_headers()
        self.wfile.write(target.read_bytes())

    def do_HEAD(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        rel = "index.html" if parsed.path in ("", "/") else parsed.path.lstrip("/")
        target = (ROOT / rel).resolve()
        if ROOT not in target.parents and target != ROOT:
            self.send_error(403)
            return
        if not target.exists() or target.is_dir():
            self.send_error(404)
            return
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("text/") or ctype.endswith("javascript") or ctype.endswith("json") else ""))
        self.end_headers()

    def log_message(self, fmt: str, *args) -> None:
        print(f"{self.address_string()} - {fmt % args}")


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Consumer dashboard running at http://127.0.0.1:{PORT}")
    print("Live endpoint: /api/live")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped")
