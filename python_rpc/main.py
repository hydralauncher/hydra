import hmac
import json
import logging
import re
import sys
import tempfile
import threading
import time
import urllib.parse

import libtorrent as lt
import psutil
from flask import Flask, jsonify, request

from http_downloader import HttpDownloader
from profile_image_processor import ProfileImageProcessor
from torrent_downloader import TorrentDownloader

app = Flask(__name__)

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("hydra.rpc")


# Retrieve command line arguments
torrent_port = sys.argv[1]
http_port = sys.argv[2]
rpc_password = sys.argv[3]
start_download_payload = sys.argv[4]
start_seeding_payload = sys.argv[5]


downloads = {}
downloads_lock = threading.RLock()
metadata_semaphore = threading.BoundedSemaphore(value=2)

# This can be streamed down from Node
downloading_game_id = -1
current_download_limit = None

torrent_session = lt.session(
    {"listen_interfaces": "0.0.0.0:{port}".format(port=torrent_port)}
)

MAGNET_HASH_HEX_RE = re.compile(r"^[a-fA-F0-9]{40}$")
MAGNET_HASH_BASE32_RE = re.compile(r"^[a-zA-Z2-7]{32}$")

TORRENT_FILES_CACHE_TTL_SECONDS = 300
TORRENT_FILES_CACHE_MAX_ITEMS = 128
torrent_files_cache = {}
torrent_files_cache_lock = threading.RLock()


def load_json_payload(raw_payload: str):
    if not raw_payload:
        return None

    return json.loads(urllib.parse.unquote(raw_payload))


def parse_file_indices(file_indices):
    if file_indices is None:
        return None

    if not isinstance(file_indices, list):
        raise ValueError("invalid_file_indices")

    parsed = []
    for index in file_indices:
        if isinstance(index, bool) or not isinstance(index, int):
            raise ValueError("invalid_file_indices")
        parsed.append(index)

    return parsed


def validate_magnet_uri(magnet: str):
    if not isinstance(magnet, str):
        raise ValueError("invalid_magnet")

    magnet = magnet.strip()
    if not magnet.startswith("magnet:"):
        raise ValueError("invalid_magnet")

    if len(magnet) > 8192:
        raise ValueError("invalid_magnet")

    parsed = urllib.parse.urlparse(magnet)
    if parsed.scheme != "magnet":
        raise ValueError("invalid_magnet")

    query = urllib.parse.parse_qs(parsed.query)
    xt_values = query.get("xt") or []

    info_hash = None
    for xt in xt_values:
        if not xt.startswith("urn:btih:"):
            continue

        hash_candidate = xt[len("urn:btih:") :].strip()

        if MAGNET_HASH_HEX_RE.match(hash_candidate) or MAGNET_HASH_BASE32_RE.match(
            hash_candidate
        ):
            info_hash = hash_candidate.lower()
            break

    if info_hash is None:
        raise ValueError("invalid_magnet")

    return magnet, info_hash


def get_cached_torrent_files(info_hash: str):
    with torrent_files_cache_lock:
        item = torrent_files_cache.get(info_hash)
        if not item:
            return None

        if time.time() - item["timestamp"] > TORRENT_FILES_CACHE_TTL_SECONDS:
            torrent_files_cache.pop(info_hash, None)
            return None

        return item["value"]


def set_cached_torrent_files(info_hash: str, value):
    with torrent_files_cache_lock:
        if len(torrent_files_cache) >= TORRENT_FILES_CACHE_MAX_ITEMS:
            oldest_key = min(
                torrent_files_cache,
                key=lambda cache_key: torrent_files_cache[cache_key]["timestamp"],
            )
            torrent_files_cache.pop(oldest_key, None)

        torrent_files_cache[info_hash] = {
            "timestamp": time.time(),
            "value": value,
        }


def map_downloader_error(error: Exception):
    code = str(error)

    if isinstance(error, TimeoutError) or code == "metadata_timeout":
        return jsonify({"error": "metadata_timeout"}), 408

    if code in {
        "invalid_magnet",
        "invalid_file_indices",
        "empty_selection",
        "invalid_url",
        "invalid_save_path",
    }:
        return jsonify({"error": code}), 400

    if code == "metadata_incomplete":
        return jsonify({"error": "metadata_incomplete"}), 422

    if code == "too_many_files":
        return jsonify({"error": "too_many_files"}), 413

    logger.error("Unhandled RPC error: %s", error, exc_info=True)
    return jsonify({"error": "internal_error"}), 500


def normalize_download_limit(value):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None

    return parsed if parsed > 0 else None


def apply_download_limit(downloader):
    if not downloader:
        return

    set_download_limit = getattr(downloader, "set_download_limit", None)
    if callable(set_download_limit):
        set_download_limit(current_download_limit)

def validate_rpc_password():
    """Middleware to validate RPC password."""
    header_password = request.headers.get("x-hydra-rpc-password")
    if not isinstance(header_password, str) or not hmac.compare_digest(
        header_password, rpc_password
    ):
        return jsonify({"error": "Unauthorized"}), 401


def start_torrent_download(game_id, url, save_path, file_indices=None, flags=None):
    with downloads_lock:
        existing_downloader = downloads.get(game_id)

    if existing_downloader and isinstance(existing_downloader, TorrentDownloader):
        apply_download_limit(existing_downloader)
        existing_downloader.start_download(url, save_path, file_indices=file_indices)
        return

    torrent_downloader = TorrentDownloader(
        torrent_session,
        flags or lt.torrent_flags.auto_managed,
        session_lock=downloads_lock,
    )
    apply_download_limit(torrent_downloader)

    with downloads_lock:
        downloads[game_id] = torrent_downloader

    try:
        torrent_downloader.start_download(url, save_path, file_indices=file_indices)
    except Exception:
        with downloads_lock:
            downloads.pop(game_id, None)
        raise


def start_http_download(game_id, url, save_path, header=None, out=None):
    with downloads_lock:
        existing_downloader = downloads.get(game_id)

    if existing_downloader and isinstance(existing_downloader, HttpDownloader):
        apply_download_limit(existing_downloader)
        existing_downloader.start_download(url, save_path, header, out)
        return

    http_downloader = HttpDownloader()
    apply_download_limit(http_downloader)

    with downloads_lock:
        downloads[game_id] = http_downloader

    try:
        http_downloader.start_download(url, save_path, header, out)
    except Exception:
        with downloads_lock:
            downloads.pop(game_id, None)
        raise


def bootstrap_downloads():
    global downloading_game_id

    initial_download = load_json_payload(start_download_payload)
    if initial_download:
        downloading_game_id = initial_download["game_id"]

        try:
            if initial_download["url"].startswith("magnet"):
                file_indices = parse_file_indices(initial_download.get("file_indices"))
                start_torrent_download(
                    initial_download["game_id"],
                    initial_download["url"],
                    initial_download["save_path"],
                    file_indices=file_indices,
                )
            else:
                start_http_download(
                    initial_download["game_id"],
                    initial_download["url"],
                    initial_download["save_path"],
                    initial_download.get("header"),
                    initial_download.get("out"),
                )
        except Exception as error:
            logger.error("Error starting initial download: %s", error, exc_info=True)

    initial_seeding = load_json_payload(start_seeding_payload)
    if initial_seeding:
        for seed in initial_seeding:
            try:
                start_torrent_download(
                    seed["game_id"],
                    seed["url"],
                    seed["save_path"],
                    flags=lt.torrent_flags.upload_mode,
                )
            except Exception as error:
                logger.error("Error starting initial seeding: %s", error, exc_info=True)


@app.route("/status", methods=["GET"])
def status():
    auth_error = validate_rpc_password()
    if auth_error:
        return auth_error

    with downloads_lock:
        downloader = downloads.get(downloading_game_id)

    if not downloader:
        return jsonify(None)

    status_payload = downloader.get_download_status()
    if not status_payload:
        return jsonify(None)

    return jsonify(status_payload), 200


@app.route("/seed-status", methods=["GET"])
def seed_status():
    auth_error = validate_rpc_password()
    if auth_error:
        return auth_error

    with downloads_lock:
        download_items = list(downloads.items())

    seed_payload = []
    for game_id, downloader in download_items:
        if not downloader:
            continue

        response = downloader.get_download_status()
        if not response:
            continue

        if response.get("status") == 5:  # Torrent seeding check
            seed_payload.append(
                {
                    "gameId": game_id,
                    **response,
                }
            )

    return jsonify(seed_payload), 200


@app.route("/healthcheck", methods=["GET"])
def healthcheck():
    return "ok", 200


@app.route("/torrent-files", methods=["POST"])
def torrent_files():
    auth_error = validate_rpc_password()
    if auth_error:
        return auth_error

    data = request.get_json(silent=True) or {}

    try:
        magnet, info_hash = validate_magnet_uri(data.get("magnet"))
    except Exception as error:
        return map_downloader_error(error)

    cached_payload = get_cached_torrent_files(info_hash)
    if cached_payload is not None:
        return jsonify(cached_payload), 200

    timeout_ms = data.get("timeout_ms", 30000)
    try:
        timeout_ms = int(timeout_ms)
    except (TypeError, ValueError):
        timeout_ms = 30000

    timeout_ms = max(5000, min(timeout_ms, 120000))
    timeout_seconds = timeout_ms / 1000

    if not metadata_semaphore.acquire(timeout=5):
        return jsonify({"error": "metadata_busy"}), 429

    temp_downloader = TorrentDownloader(
        torrent_session,
        lt.torrent_flags.upload_mode,
        session_lock=downloads_lock,
    )

    started_at = time.time()

    try:
        temp_downloader.start_download(magnet, tempfile.gettempdir())
        files_payload = temp_downloader.get_torrent_files(timeout_seconds=timeout_seconds)
        response = {
            "infoHash": info_hash,
            **files_payload,
        }

        set_cached_torrent_files(info_hash, response)

        elapsed_ms = int((time.time() - started_at) * 1000)
        logger.info("Resolved torrent metadata hash=%s in %sms", info_hash, elapsed_ms)

        return jsonify(response), 200
    except Exception as error:
        return map_downloader_error(error)
    finally:
        temp_downloader.cancel_download()
        metadata_semaphore.release()


@app.route("/process-list", methods=["GET"])
def process_list():
    auth_error = validate_rpc_password()
    if auth_error:
        return auth_error

    iter_list = ["exe", "pid", "name"]
    if sys.platform != "win32":
        iter_list.append("cwd")
        iter_list.append("environ")

    process_list_payload = [proc.info for proc in psutil.process_iter(iter_list)]
    return jsonify(process_list_payload), 200


@app.route("/profile-image", methods=["POST"])
def profile_image():
    auth_error = validate_rpc_password()
    if auth_error:
        return auth_error

    data = request.get_json()
    image_path = data.get("image_path")

    # use webp as default value for target_extension
    target_extension = data.get("target_extension") or "webp"

    try:
        processed_image_path, mime_type = ProfileImageProcessor.process_image(
            image_path, target_extension
        )
        return jsonify({"imagePath": processed_image_path, "mimeType": mime_type}), 200
    except Exception as error:
        return jsonify({"error": str(error)}), 400


@app.route("/action", methods=["POST"])
def action():
    global downloading_game_id
    global current_download_limit

    auth_error = validate_rpc_password()
    if auth_error:
        return auth_error

    data = request.get_json(silent=True) or {}
    action_name = data.get("action")
    game_id = data.get("game_id")

    if not action_name:
        return jsonify({"error": "invalid_action"}), 400

    requires_game_id = {"start", "pause", "cancel", "resume_seeding", "pause_seeding"}
    if action_name in requires_game_id and not game_id:
        return jsonify({"error": "invalid_game_id"}), 400

    try:
        if action_name == "start":
            url = data.get("url")
            if not isinstance(url, str):
                raise ValueError("invalid_url")

            save_path = data.get("save_path")
            if not isinstance(save_path, str):
                raise ValueError("invalid_save_path")

            if url.startswith("magnet"):
                file_indices = parse_file_indices(data.get("file_indices"))
                start_torrent_download(
                    game_id,
                    url,
                    save_path,
                    file_indices=file_indices,
                )
            else:
                start_http_download(
                    game_id,
                    url,
                    save_path,
                    data.get("header"),
                    data.get("out"),
                )

            downloading_game_id = game_id
        elif action_name == "pause":
            with downloads_lock:
                downloader = downloads.get(game_id)

            if downloader:
                downloader.pause_download()

            if downloading_game_id == game_id:
                downloading_game_id = -1
        elif action_name == "cancel":
            with downloads_lock:
                downloader = downloads.get(game_id)

            if downloader:
                downloader.cancel_download()

            with downloads_lock:
                downloads.pop(game_id, None)

            if downloading_game_id == game_id:
                downloading_game_id = -1
        elif action_name == "resume_seeding":
            start_torrent_download(
                game_id,
                data["url"],
                data["save_path"],
                flags=lt.torrent_flags.upload_mode,
            )
        elif action_name == "pause_seeding":
            with downloads_lock:
                downloader = downloads.get(game_id)

            if downloader:
                downloader.cancel_download()

            with downloads_lock:
                downloads.pop(game_id, None)
        elif action_name == "set_download_limit":
            current_download_limit = normalize_download_limit(
                data.get("max_download_speed_bytes_per_second")
            )

            with downloads_lock:
                active_downloaders = list(downloads.values())

            for downloader in active_downloaders:
                apply_download_limit(downloader)
        else:
            return jsonify({"error": "invalid_action"}), 400
    except Exception as error:
        return map_downloader_error(error)

    return "", 200


bootstrap_downloads()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(http_port), threaded=True)
