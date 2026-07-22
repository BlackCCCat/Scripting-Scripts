import json
import os
import sys
import time
import traceback

from yt_dlp import YoutubeDL


class DownloadCancelled(Exception):
    pass


def media_files_under(directory, since):
    extensions = {".mp4", ".m4v", ".mov", ".mkv", ".webm", ".m4a", ".aac", ".opus"}
    if not os.path.isdir(directory):
        return []

    result = []
    for root, _, files in os.walk(directory):
        for name in files:
            path = os.path.join(root, name)
            if os.path.splitext(path)[1].lower() not in extensions:
                continue
            try:
                if os.path.getmtime(path) >= since:
                    result.append(os.path.abspath(path))
            except OSError:
                pass
    return sorted(result, key=lambda item: os.path.getmtime(item) if os.path.exists(item) else 0)


def cleanup_media_files(directory, since):
    for path in media_files_under(directory, since):
        try:
            os.remove(path)
        except OSError:
            pass


def best_thumbnail(info):
    thumbnails = info.get("thumbnails") or []
    for item in reversed(thumbnails):
        url = item.get("url")
        if url:
            return url
    return info.get("thumbnail")


def print_metadata(info, fallback_url):
    metadata = {
        "id": info.get("id"),
        "title": info.get("title"),
        "description": info.get("description"),
        "webpage_url": info.get("webpage_url") or info.get("original_url") or fallback_url,
        "thumbnail": best_thumbnail(info),
    }
    print("MEDIA_DOWNLOADER_METADATA " + json.dumps(metadata, ensure_ascii=False))


def safe_format(item):
    keys = [
        "format_id",
        "format_note",
        "ext",
        "vcodec",
        "acodec",
        "height",
        "width",
        "abr",
        "tbr",
        "fps",
        "filesize",
        "filesize_approx",
        "protocol",
    ]
    return {key: item.get(key) for key in keys if item.get(key) is not None}


def print_probe(info, fallback_url):
    formats = info.get("formats") or []
    payload = {
        "id": info.get("id"),
        "title": info.get("title"),
        "description": info.get("description"),
        "webpage_url": info.get("webpage_url") or info.get("original_url") or fallback_url,
        "thumbnail": best_thumbnail(info),
        "extractor_key": info.get("extractor_key"),
        "duration": info.get("duration"),
        "formats": [safe_format(item) for item in formats if item.get("format_id")],
    }
    print("MEDIA_DOWNLOADER_PROBE " + json.dumps(payload, ensure_ascii=False))


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Missing config path")

    with open(sys.argv[1], "r", encoding="utf-8") as file:
        config = json.load(file)

    started_at = time.time()
    finished_paths = []
    cancel_flag = config.get("cancel_flag")
    progress_path = config.get("progress_path")

    def write_progress(status):
        if not progress_path:
            return
        downloaded = status.get("downloaded_bytes") or 0
        total = status.get("total_bytes") or status.get("total_bytes_estimate")
        fragment_index = status.get("fragment_index")
        fragment_count = status.get("fragment_count")
        percent = None
        if total:
            percent = max(0, min(100, downloaded * 100 / total))
        elif fragment_index and fragment_count:
            percent = max(0, min(100, fragment_index * 100 / fragment_count))
        elif status.get("_percent_str"):
            try:
                percent = float(str(status.get("_percent_str")).strip().replace("%", ""))
            except Exception:
                percent = None
        payload = {
            "status": status.get("status"),
            "percent": percent,
            "downloadedBytes": downloaded,
            "totalBytes": total,
            "speed": status.get("speed"),
            "eta": status.get("eta"),
            "fragmentIndex": fragment_index,
            "fragmentCount": fragment_count,
            "updatedAt": time.time(),
        }
        tmp_path = progress_path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as file:
            json.dump(payload, file)
        os.replace(tmp_path, progress_path)

    def progress_hook(status):
        write_progress(status)
        if cancel_flag and os.path.exists(cancel_flag):
            raise DownloadCancelled("Download canceled")
        if status.get("status") != "finished":
            return
        filename = status.get("filename")
        if filename:
            finished_paths.append(os.path.abspath(filename))

    options = {
        "format_sort": config.get("format_sort") or [],
        "noplaylist": True,
        "quiet": False,
        "no_warnings": False,
    }
    if config.get("no_check_certificate"):
        options["nocheckcertificate"] = True
    if isinstance(config.get("http_headers"), dict):
        options["http_headers"] = {
            str(key): str(value)
            for key, value in config.get("http_headers").items()
            if value is not None
        }
    if config.get("cookiefile"):
        options["cookiefile"] = config.get("cookiefile")

    mode = config.get("mode") or "download"
    if mode != "probe":
        options["format"] = config["format"]

    if mode == "probe":
        options.pop("format", None)
        options.update({
            "skip_download": True,
            "extract_flat": False,
        })
        try:
            with YoutubeDL(options) as ydl:
                info = ydl.extract_info(config["url"], download=False)
        except BaseException:
            if cancel_flag and os.path.exists(cancel_flag):
                print("MEDIA_DOWNLOADER_CANCELLED Download canceled")
                raise SystemExit(130)
            print("MEDIA_DOWNLOADER_TRACEBACK")
            traceback.print_exc()
            raise
        print_metadata(info, config["url"])
        print_probe(info, config["url"])
        return

    options.update({
        "outtmpl": config["output"],
        "paths": {"home": config["paths"]},
        "progress_hooks": [progress_hook],
    })

    try:
        with YoutubeDL(options) as ydl:
            info = ydl.extract_info(config["url"], download=True)
    except DownloadCancelled as error:
        cleanup_media_files(config["paths"], started_at)
        print("MEDIA_DOWNLOADER_CANCELLED " + str(error))
        raise SystemExit(130)
    except BaseException:
        if cancel_flag and os.path.exists(cancel_flag):
            cleanup_media_files(config["paths"], started_at)
            print("MEDIA_DOWNLOADER_CANCELLED Download canceled")
            raise SystemExit(130)
        print("MEDIA_DOWNLOADER_TRACEBACK")
        traceback.print_exc()
        raise

    print_metadata(info, config["url"])

    with YoutubeDL(options) as ydl:
        for item in info.get("requested_downloads") or []:
            path = item.get("filepath") or item.get("_filename")
            if path:
                finished_paths.append(os.path.abspath(path))
        if not finished_paths:
            path = ydl.prepare_filename(info)
            if path:
                finished_paths.append(os.path.abspath(path))

    finished_paths.extend(media_files_under(config["paths"], started_at))

    seen = set()
    for path in finished_paths:
        if not os.path.exists(path):
            continue
        if path in seen:
            continue
        seen.add(path)
        print(path)


if __name__ == "__main__":
    main()
