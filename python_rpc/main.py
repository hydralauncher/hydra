import asyncio
import sys
import json
import urllib.parse
import psutil
from typing import Dict, Any, Optional
from quart import Quart, request, jsonify
from torrent_downloader import TorrentDownloader
from http_downloader import HttpDownloader
from profile_image_processor import ProfileImageProcessor
from http_multi_link_downloader import HttpMultiLinkDownloader
import libtorrent as lt

# Use uvloop on Linux/Mac for better performance
if sys.platform != 'win32':
    try:
        import uvloop
        asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())
    except ImportError:
        pass

app = Quart(__name__)

# Retrieve command line arguments
torrent_port = sys.argv[1]
http_port = sys.argv[2]
rpc_password = sys.argv[3]
start_download_payload = sys.argv[4] if len(sys.argv) > 4 else None
start_seeding_payload = sys.argv[5] if len(sys.argv) > 5 else None

downloads: Dict[int, Any] = {}
downloading_game_id = -1

torrent_session = lt.session({'listen_interfaces': f'0.0.0.0:{torrent_port}'})


async def initialize_downloads():
    global downloading_game_id
    
    if start_download_payload:
        initial_download = json.loads(urllib.parse.unquote(start_download_payload))
        downloading_game_id = initial_download['game_id']
        
        if isinstance(initial_download['url'], list):
            http_multi_downloader = HttpMultiLinkDownloader()
            downloads[initial_download['game_id']] = http_multi_downloader
            try:
                await http_multi_downloader.start_download(
                    initial_download['url'],
                    initial_download['save_path'],
                    initial_download.get('header'),
                    initial_download.get("out"),
                    initial_download.get('total_size')
                )
            except Exception:
                pass
        elif initial_download['url'].startswith('magnet'):
            torrent_downloader = TorrentDownloader(torrent_session)
            downloads[initial_download['game_id']] = torrent_downloader
            try:
                await torrent_downloader.start_download(
                    initial_download['url'],
                    initial_download['save_path']
                )
            except Exception:
                pass
        else:
            http_downloader = HttpDownloader()
            downloads[initial_download['game_id']] = http_downloader
            try:
                await http_downloader.start_download(
                    initial_download['url'],
                    initial_download['save_path'],
                    initial_download.get('header', ''),
                    initial_download.get('out')
                )
            except Exception:
                pass

    if start_seeding_payload:
        initial_seeding = json.loads(urllib.parse.unquote(start_seeding_payload))
        for seed in initial_seeding:
            torrent_downloader = TorrentDownloader(torrent_session, lt.torrent_flags.upload_mode)
            downloads[seed['game_id']] = torrent_downloader
            try:
                await torrent_downloader.start_download(seed['url'], seed['save_path'])
            except Exception:
                pass


async def validate_rpc_password():
    header_password = request.headers.get('x-hydra-rpc-password')
    if header_password != rpc_password:
        return jsonify({"error": "Unauthorized"}), 401
    return None


@app.route("/status", methods=["GET"])
async def status():
    auth_error = await validate_rpc_password()
    if auth_error:
        return auth_error

    downloader = downloads.get(downloading_game_id)
    if not downloader:
        return jsonify(None)

    status_result = await downloader.get_download_status()
    if not status_result:
        return jsonify(None)

    if isinstance(status_result, list):
        if not status_result:
            return jsonify(None)
        return jsonify(status_result[0]), 200

    return jsonify(status_result), 200


@app.route("/seed-status", methods=["GET"])
async def seed_status():
    auth_error = await validate_rpc_password()
    if auth_error:
        return auth_error
    
    seed_status_list = []

    for game_id, downloader in downloads.items():
        if not downloader:
            continue
        
        response = await downloader.get_download_status()
        if not response:
            continue
        
        if isinstance(response, list):
            if response and all(item.get('status') == 'complete' for item in response):
                seed_status_list.append({
                    'gameId': game_id,
                    'status': 'complete',
                    'folderName': response[0].get('folderName', ''),
                    'fileSize': sum(item.get('fileSize', 0) for item in response),
                    'bytesDownloaded': sum(item.get('bytesDownloaded', 0) for item in response),
                    'downloadSpeed': 0,
                    'numPeers': 0,
                    'numSeeds': 0,
                    'progress': 1.0
                })
        elif response.get('status') == 5:
            seed_status_list.append({
                'gameId': game_id,
                **response,
            })

    return jsonify(seed_status_list), 200


@app.route("/healthcheck", methods=["GET"])
async def healthcheck():
    return "ok", 200


@app.route("/process-list", methods=["GET"])
async def process_list():
    auth_error = await validate_rpc_password()
    if auth_error:
        return auth_error
    
    iter_list = ['exe', 'pid', 'name']
    if sys.platform != 'win32':
        iter_list.extend(['cwd', 'environ'])

    def _get_processes():
        return [proc.info for proc in psutil.process_iter(iter_list)]
    
    process_list_result = await asyncio.to_thread(_get_processes)
    return jsonify(process_list_result), 200


@app.route("/profile-image", methods=["POST"])
async def profile_image():
    auth_error = await validate_rpc_password()
    if auth_error:
        return auth_error

    data = await request.get_json()
    image_path = data.get('image_path')

    if not image_path:
        return jsonify({"error": "image_path is required"}), 400

    try:
        processed_image_path, mime_type = await ProfileImageProcessor.process_image(image_path)
        return jsonify({'imagePath': processed_image_path, 'mimeType': mime_type}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/action", methods=["POST"])
async def action():
    global downloading_game_id

    auth_error = await validate_rpc_password()
    if auth_error:
        return auth_error

    data = await request.get_json()
    action_type = data.get('action')
    game_id = data.get('game_id')

    if action_type == 'start':
        url = data.get('url')
        if not url:
            return jsonify({"error": "url is required"}), 400

        existing_downloader = downloads.get(game_id)

        if isinstance(url, list):
            if existing_downloader and isinstance(existing_downloader, HttpMultiLinkDownloader):
                await existing_downloader.start_download(
                    url, data['save_path'], data.get('header'), data.get('out'), data.get('total_size')
                )
            else:
                http_multi_downloader = HttpMultiLinkDownloader()
                downloads[game_id] = http_multi_downloader
                await http_multi_downloader.start_download(
                    url, data['save_path'], data.get('header'), data.get('out'), data.get('total_size')
                )
        elif url.startswith('magnet'):
            if existing_downloader and isinstance(existing_downloader, TorrentDownloader):
                await existing_downloader.start_download(url, data['save_path'])
            else:
                torrent_downloader = TorrentDownloader(torrent_session)
                downloads[game_id] = torrent_downloader
                await torrent_downloader.start_download(url, data['save_path'])
        else:
            if existing_downloader and isinstance(existing_downloader, HttpDownloader):
                await existing_downloader.start_download(
                    url, data['save_path'], data.get('header', ''), data.get('out')
                )
            else:
                http_downloader = HttpDownloader()
                downloads[game_id] = http_downloader
                await http_downloader.start_download(
                    url, data['save_path'], data.get('header', ''), data.get('out')
                )
        
        downloading_game_id = game_id

    elif action_type == 'pause':
        downloader = downloads.get(game_id)
        if downloader:
            await downloader.pause_download()
        
        if downloading_game_id == game_id:
            downloading_game_id = -1
            
    elif action_type == 'cancel':
        downloader = downloads.get(game_id)
        if downloader:
            await downloader.cancel_download()
            
    elif action_type == 'resume_seeding':
        torrent_downloader = TorrentDownloader(torrent_session, lt.torrent_flags.upload_mode)
        downloads[game_id] = torrent_downloader
        await torrent_downloader.start_download(data['url'], data['save_path'])
        
    elif action_type == 'pause_seeding':
        downloader = downloads.get(game_id)
        if downloader:
            await downloader.cancel_download()
    else:
        return jsonify({"error": "Invalid action"}), 400

    return "", 200


@app.before_serving
async def startup():
    await initialize_downloads()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(http_port))
