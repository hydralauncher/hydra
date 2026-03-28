import hmac
import json
import logging
import re
import sys
import tempfile
import threading
import time
import urllib.parse
from typing import Any, Optional

import libtorrent as lt

from torrent_downloader import TorrentDownloader

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("hydra.rpc")



def parse_cli_args(argv):
    if len(argv) >= 6:
        # Legacy format:
        # [script, torrent_port, http_port, rpc_password, initial_download, initial_seeding]
        torrent_port_arg = argv[1]
        rpc_password_arg = argv[3]
        initial_download_arg = argv[4]
        initial_seeding_arg = argv[5]
        return (
            torrent_port_arg,
            rpc_password_arg,
            initial_download_arg,
            initial_seeding_arg,
        )

    if len(argv) >= 5:
        # Stdio format with RPC password:
        # [script, torrent_port, rpc_password, initial_download, initial_seeding]
        torrent_port_arg = argv[1]
        rpc_password_arg = argv[2]
        initial_download_arg = argv[3]
        initial_seeding_arg = argv[4]
        return (
            torrent_port_arg,
            rpc_password_arg,
            initial_download_arg,
            initial_seeding_arg,
        )

    if len(argv) >= 4:
        # Backward-compatible stdio format (no RPC password):
        # [script, torrent_port, initial_download, initial_seeding]
        torrent_port_arg = argv[1]
        initial_download_arg = argv[2]
        initial_seeding_arg = argv[3]
        return (
            torrent_port_arg,
            "",
            initial_download_arg,
            initial_seeding_arg,
        )

    raise ValueError("invalid_arguments")


torrent_port, rpc_password, start_download_payload, start_seeding_payload = parse_cli_args(
    sys.argv
)


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
stdout_lock = threading.RLock()


class RpcError(Exception):
    def __init__(self, code: str, message: Optional[str] = None):
        super().__init__(message or code)
        self.code = code
        self.message = message or code


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


def map_downloader_error_code(error: Exception):
    code = str(error)

    if isinstance(error, TimeoutError) or code == "metadata_timeout":
        return "metadata_timeout"

    if code in {
        "invalid_magnet",
        "invalid_file_indices",
        "empty_selection",
        "invalid_url",
        "invalid_save_path",
    }:
        return code

    if code == "metadata_incomplete":
        return "metadata_incomplete"

    if code == "too_many_files":
        return "too_many_files"

    logger.error("Unhandled RPC error: %s", error, exc_info=True)
    return "internal_error"


def normalize_download_limit(value):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None

    return parsed if parsed > 0 else None


def normalize_metadata_timeout_ms(value):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None

    return max(5000, min(parsed, 120000))


def apply_download_limit(downloader):
    if not downloader:
        return

    set_download_limit = getattr(downloader, "set_download_limit", None)
    if callable(set_download_limit):
        set_download_limit(current_download_limit)

def validate_rpc_password_value(password: Optional[str]):
    if rpc_password == "":
        return True

    if not isinstance(password, str):
        return False

    return hmac.compare_digest(password, rpc_password)


def start_torrent_download(
    game_id,
    url,
    save_path,
    file_indices=None,
    flags=None,
    metadata_timeout_ms=None,
):
    normalized_metadata_timeout_ms = normalize_metadata_timeout_ms(metadata_timeout_ms)
    start_kwargs = {
        "file_indices": file_indices,
    }
    if normalized_metadata_timeout_ms is not None:
        start_kwargs["wait_timeout_seconds"] = normalized_metadata_timeout_ms / 1000

    with downloads_lock:
        existing_downloader = downloads.get(game_id)

    if existing_downloader and isinstance(existing_downloader, TorrentDownloader):
        apply_download_limit(existing_downloader)
        existing_downloader.start_download(url, save_path, **start_kwargs)
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
        torrent_downloader.start_download(url, save_path, **start_kwargs)
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
                    metadata_timeout_ms=initial_download.get("metadata_timeout_ms"),
                )
            else:
                raise ValueError("invalid_url")
        except Exception as error:
            downloading_game_id = -1
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


def status():
    with downloads_lock:
        downloader = downloads.get(downloading_game_id)

    if not downloader:
        return None

    status_payload = downloader.get_download_status()
    if not status_payload:
        return None

    return status_payload


def seed_status():
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

    return seed_payload


def torrent_files(data: Optional[dict] = None):
    data = data or {}

    try:
        magnet, info_hash = validate_magnet_uri(data.get("magnet"))
    except Exception as error:
        raise RpcError(map_downloader_error_code(error)) from error

    cached_payload = get_cached_torrent_files(info_hash)
    if cached_payload is not None:
        return cached_payload

    timeout_ms = data.get("timeout_ms", 30000)
    try:
        timeout_ms = int(timeout_ms)
    except (TypeError, ValueError):
        timeout_ms = 30000

    timeout_ms = max(5000, min(timeout_ms, 120000))
    timeout_seconds = timeout_ms / 1000

    if not metadata_semaphore.acquire(timeout=5):
        raise RpcError("metadata_busy")

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

        return response
    except Exception as error:
        raise RpcError(map_downloader_error_code(error)) from error
    finally:
        temp_downloader.cancel_download()
        metadata_semaphore.release()


def action(data: Optional[dict] = None):
    global downloading_game_id
    global current_download_limit

    data = data or {}
    action_name = data.get("action")
    game_id = data.get("game_id")

    if not action_name:
        raise RpcError("invalid_action")

    requires_game_id = {"start", "pause", "cancel", "resume_seeding", "pause_seeding"}
    if action_name in requires_game_id and not game_id:
        raise RpcError("invalid_game_id")

    try:
        if action_name == "start":
            url = data.get("url")
            if not isinstance(url, str):
                raise RpcError("invalid_url")

            save_path = data.get("save_path")
            if not isinstance(save_path, str):
                raise RpcError("invalid_save_path")

            if url.startswith("magnet"):
                file_indices = parse_file_indices(data.get("file_indices"))
                start_torrent_download(
                    game_id,
                    url,
                    save_path,
                    file_indices=file_indices,
                    metadata_timeout_ms=data.get("metadata_timeout_ms"),
                )
            else:
                raise RpcError("invalid_url")

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
            raise RpcError("invalid_action")
    except RpcError:
        raise
    except Exception as error:
        raise RpcError(map_downloader_error_code(error)) from error

    return None


def write_response(payload: dict):
    serialized = json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
    with stdout_lock:
        sys.stdout.write(serialized + "\n")
        sys.stdout.flush()


def build_error_response(request_id: Any, code: str, message: Optional[str] = None):
    return {
        "id": request_id,
        "error": {
            "code": code,
            "message": message or code,
        },
    }


def dispatch_method(method: str, params: Optional[dict]):
    payload = params or {}

    if method == "status":
        return status()

    if method == "seed_status":
        return seed_status()

    if method == "torrent_files":
        return torrent_files(payload)

    if method == "action":
        return action(payload)

    raise RpcError("method_not_found", f"Unknown method: {method}")


def handle_request(request_payload: dict):
    request_id = request_payload.get("id")
    method = request_payload.get("method")
    params = request_payload.get("params")
    rpc_password_value = request_payload.get("rpc_password")

    if not validate_rpc_password_value(rpc_password_value):
        write_response(build_error_response(request_id, "unauthorized", "Unauthorized"))
        return

    if request_id is None:
        write_response(build_error_response(None, "invalid_request", "Missing request id"))
        return

    if not isinstance(method, str) or not method:
        write_response(build_error_response(request_id, "invalid_method", "Invalid method"))
        return

    if params is not None and not isinstance(params, dict):
        write_response(
            build_error_response(request_id, "invalid_params", "Params must be an object")
        )
        return

    try:
        result = dispatch_method(method, params)
        write_response({"id": request_id, "result": result})
    except RpcError as error:
        write_response(build_error_response(request_id, error.code, error.message))
    except Exception as error:
        logger.error("Unhandled RPC dispatcher error: %s", error, exc_info=True)
        write_response(build_error_response(request_id, "internal_error", "internal_error"))


def start_stdio_rpc_loop():
    write_response({"event": "ready", "protocolVersion": 1})

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        try:
            payload = json.loads(line)
        except Exception:
            write_response(build_error_response(None, "invalid_json", "Invalid JSON"))
            continue

        if not isinstance(payload, dict):
            write_response(build_error_response(None, "invalid_request", "Request must be an object"))
            continue

        request_thread = threading.Thread(
            target=handle_request,
            args=(payload,),
            daemon=True,
        )
        request_thread.start()


bootstrap_downloads()


if __name__ == "__main__":
    start_stdio_rpc_loop()
