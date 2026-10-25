#!/usr/bin/env python3
"""Import primary Playground demos, not recommendation videos. Never download clips."""
import concurrent.futures
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "artifacts/api-server/src/lib/video-catalog.json"
OUTPUT = ROOT / "artifacts/meduha/src/meduha/video/model-preview-media.json"
MEDIA_HOST = "d28lhcrx5qdowv.cloudfront.net"
HEADERS = {"User-Agent": "Meduha-Preview-Catalog/1.0"}


def approved(url):
    parsed = urlsplit(url or "")
    return parsed.scheme == "https" and parsed.hostname == MEDIA_HOST and parsed.path.startswith("/media/explore/media/")


class PlaygroundMedia(HTMLParser):
    def __init__(self):
        super().__init__()
        self.videos = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "video" and approved(attrs.get("src")):
            self.videos.append(attrs)


def fetch_model(model):
    source = model["source"]
    try:
        with urlopen(Request(source, headers=HEADERS), timeout=35) as response:
            html = response.read(3_000_000).decode("utf-8")
            if urlsplit(response.url).path != urlsplit(source).path:
                raise ValueError("Playground redirected to a different page")
        parser = PlaygroundMedia()
        parser.feed(html)
        # Only the primary player has this accessible label. Promotional and
        # comparison cards elsewhere on the same page are not that model's demo.
        player = next((video for video in parser.videos if "example video" in video.get("aria-label", "").lower()), None)
        if not player:
            return model["id"], {"source": source, "unavailable": "no-primary-example"}
        entry = {"source": source, "video": player["src"]}
        if approved(player.get("poster")):
            entry["thumb"] = player["poster"]
        return model["id"], entry
    except (HTTPError, URLError, TimeoutError, ValueError) as error:
        return model["id"], {"source": source, "unavailable": "page-unavailable", "detail": str(error)}


def check_asset(url):
    try:
        with urlopen(Request(url, headers=HEADERS, method="HEAD"), timeout=25) as response:
            content_type = response.headers.get("Content-Type", "").split(";")[0]
            expected = "video/" if url.endswith(".mp4") else "image/"
            return url, response.status == 200 and content_type.startswith(expected)
    except (HTTPError, URLError, TimeoutError):
        return url, False


def main():
    models = json.loads(CATALOG.read_text())["models"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        found = dict(pool.map(fetch_model, models))
    urls = sorted({entry[field] for entry in found.values() for field in ("video", "thumb") if field in entry})
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        verified = dict(pool.map(check_asset, urls))
    for entry in found.values():
        if entry.get("video") and not verified[entry["video"]]:
            entry.pop("video")
            entry.pop("thumb", None)
            entry["unavailable"] = "video-unavailable"
        elif entry.get("thumb") and not verified[entry["thumb"]]:
            entry.pop("thumb")
    OUTPUT.write_text(json.dumps({"models": found}, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({
        "models": len(models),
        "withVideo": sum("video" in entry for entry in found.values()),
        "uniqueVideos": len({entry["video"] for entry in found.values() if "video" in entry}),
        "checkedAssets": len(urls),
        "unavailable": {key: entry for key, entry in found.items() if "video" not in entry},
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
