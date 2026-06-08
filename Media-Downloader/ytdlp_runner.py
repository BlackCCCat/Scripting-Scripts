import json
import os
import sys
import time

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


def print_stream(info):
    stream = {
        "url": info.get("url"),
        "ext": info.get("ext"),
        "format_id": info.get("format_id"),
        "filesize": info.get("filesize"),
        "filesize_approx": info.get("filesize_approx"),
        "http_headers": info.get("http_headers") or {},
    }
    print("MEDIA_DOWNLOADER_STREAM " + json.dumps(stream, ensure_ascii=False))


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Missing config path")

    with open(sys.argv[1], "r", encoding="utf-8") as file:
        config = json.load(file)

    started_at = time.time()
    finished_paths = []
    cancel_flag = config.get("cancel_flag")

    def progress_hook(status):
        if cancel_flag and os.path.exists(cancel_flag):
            raise DownloadCancelled("Download canceled")
        if status.get("status") != "finished":
            return
        filename = status.get("filename")
        if filename:
            finished_paths.append(os.path.abspath(filename))

    options = {
        "format": config["format"],
        "noplaylist": True,
        "quiet": False,
        "no_warnings": False,
    }

    if config.get("mode") == "extract":
        try:
            with YoutubeDL(options) as ydl:
                info = ydl.extract_info(config["url"], download=False)
        except BaseException:
            if cancel_flag and os.path.exists(cancel_flag):
                print("MEDIA_DOWNLOADER_CANCELLED Download canceled")
                raise SystemExit(130)
            raise

        print_metadata(info, config["url"])
        print_stream(info)
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
