from flask import Flask, request, jsonify
import sys, json, urllib.parse, psutil
from torrent_downloader import TorrentDownloader
from http_downloader import HttpDownloader
from http_multi_link_downloader import HttpMultiLinkDownloader
from profile_image_processor import ProfileImageProcessor
import libtorrent as lt

app = Flask(__name__)

# Retrieve command line arguments
torrent_port = sys.argv[1]
http_port = sys.argv[2]
rpc_password = sys.argv[3]
start_download_payload = sys.argv[4]
start_seeding_payload = sys.argv[5]

downloads = {}
# This can be streamed down from Node
downloading_game_id = -1

torrent_session = lt.session({'listen_interfaces': '0.0.0.0:{port}'.format(port=torrent_port)})

if start_download_payload:
    initial_download = json.loads(urllib.parse.unquote(start_download_payload))
    downloading_game_id = initial_download['game_id']
    
    if isinstance(initial_download['url'], list):
        # Handle multiple URLs using HttpMultiLinkDownloader
        http_multi_downloader = HttpMultiLinkDownloader()
        downloads[initial_download['game_id']] = http_multi_downloader
        try:
            http_multi_downloader.start_download(initial_download['url'], initial_download['save_path'], initial_download.get('header'), initial_download.get("out"))
        except Exception as e:
            print("Error starting multi-link download", e)
    elif initial_download['url'].startswith('magnet'):
        torrent_downloader = TorrentDownloader(torrent_session)
        downloads[initial_download['game_id']] = torrent_downloader
        try:
            torrent_downloader.start_download(initial_download['url'], initial_download['save_path'])
        except Exception as e:
            print("Error starting torrent download", e)
    else:
        http_downloader = HttpDownloader()
        downloads[initial_download['game_id']] = http_downloader
        try:
            http_downloader.start_download(initial_download['url'], initial_download['save_path'], initial_download.get('header'), initial_download.get("out"))
        except Exception as e:
            print("Error starting http download", e)

if start_seeding_payload:
    initial_seeding = json.loads(urllib.parse.unquote(start_seeding_payload))
    for seed in initial_seeding:
        torrent_downloader = TorrentDownloader(torrent_session, lt.torrent_flags.upload_mode)
        downloads[seed['game_id']] = torrent_downloader
        try:
            torrent_downloader.start_download(seed['url'], seed['save_path'])
        except Exception as e:
            print("Error starting seeding", e)

def validate_rpc_password():
    """Middleware to validate RPC password."""
    header_password = request.headers.get('x-hydra-rpc-password')
    if header_password != rpc_password:
        return jsonify({"error": "Unauthorized"}), 401

@app.route("/status", methods=["GET"])
def status():
    auth_error = validate_rpc_password()
    if auth_error:
        return auth_error

    downloader = downloads.get(downloading_game_id)
    if not downloader:
        return jsonify(None)

    status = downloader.get_download_status()
    if not status:
        return jsonify(None)

    if isinstance(status, list):
        if not status:  # Empty list
            return jsonify(None)
            
        # For multi-link downloader, use the aggregated status
        # The status will already be aggregated by the HttpMultiLinkDownloader
        return jsonify(status[0]), 200

    return jsonify(status), 200

@app.route("/seed-status", methods=["GET"])
def seed_status():
    auth_error = validate_rpc_password()
    if auth_error:
        return auth_error
    
    seed_status = []

    for game_id, downloader in downloads.items():
        if not downloader:
            continue
        
        response = downloader.get_download_status()
        if not response:
            continue
        
        if isinstance(response, list):
            # For multi-link downloader, check if all files are complete
            if response and all(item['status'] == 'complete' for item in response):
                seed_status.append({
                    'gameId': game_id,
                    'status': 'complete',
                    'folderName': response[0]['folderName'],
                    'fileSize': sum(item['fileSize'] for item in response),
                    'bytesDownloaded': sum(item['bytesDownloaded'] for item in response),
                    'downloadSpeed': 0,
                    'numPeers': 0,
                    'numSeeds': 0,
                    'progress': 1.0
                })
        elif response.get('status') == 5:  # Original torrent seeding check
            seed_status.append({
                'gameId': game_id,
                **response,
            })

    return jsonify(seed_status), 200

@app.route("/healthcheck", methods=["GET"])
def healthcheck():
    return "ok", 200

@app.route("/process-list", methods=["GET"])
def process_list():
    auth_error = validate_rpc_password()
    if auth_error:
        return auth_error

    process_list = [proc.info for proc in psutil.process_iter(['exe', 'pid', 'name'])]
    return jsonify(process_list), 200

@app.route("/profile-image", methods=["POST"])
def profile_image():
    auth_error = validate_rpc_password()
    if auth_error:
        return auth_error

    data = request.get_json()
    image_path = data.get('image_path')

    try:
        processed_image_path, mime_type = ProfileImageProcessor.process_image(image_path)
        return jsonify({'imagePath': processed_image_path, 'mimeType': mime_type}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/action", methods=["POST"])
def action():
    global torrent_session
    global downloading_game_id

    auth_error = validate_rpc_password()
    if auth_error:
        return auth_error

    data = request.get_json()
    action = data.get('action')
    game_id = data.get('game_id')

    if action == 'start':
        url = data.get('url')

        existing_downloader = downloads.get(game_id)

        if isinstance(url, list):
            # Handle multiple URLs using HttpMultiLinkDownloader
            if existing_downloader and isinstance(existing_downloader, HttpMultiLinkDownloader):
                existing_downloader.start_download(url, data['save_path'], data.get('header'), data.get('out'))
            else:
                http_multi_downloader = HttpMultiLinkDownloader()
                downloads[game_id] = http_multi_downloader
                http_multi_downloader.start_download(url, data['save_path'], data.get('header'), data.get('out'))
        elif url.startswith('magnet'):
            if existing_downloader and isinstance(existing_downloader, TorrentDownloader):
                existing_downloader.start_download(url, data['save_path'])
            else:
                torrent_downloader = TorrentDownloader(torrent_session)
                downloads[game_id] = torrent_downloader
                torrent_downloader.start_download(url, data['save_path'])
        else:
            if existing_downloader and isinstance(existing_downloader, HttpDownloader):
                existing_downloader.start_download(url, data['save_path'], data.get('header'), data.get('out'))
            else:
                http_downloader = HttpDownloader()
                downloads[game_id] = http_downloader
                http_downloader.start_download(url, data['save_path'], data.get('header'), data.get('out'))
        
        downloading_game_id = game_id

    elif action == 'pause':
        downloader = downloads.get(game_id)
        if downloader:
            downloader.pause_download()
            downloading_game_id = -1
    elif action == 'cancel':
        downloader = downloads.get(game_id)
        if downloader:
            downloader.cancel_download()
    elif action == 'resume_seeding':
        torrent_downloader = TorrentDownloader(torrent_session, lt.torrent_flags.upload_mode)
        downloads[game_id] = torrent_downloader
        torrent_downloader.start_download(data['url'], data['save_path'])
    elif action == 'pause_seeding':
        downloader = downloads.get(game_id)
        if downloader:
            downloader.cancel_download()

    else:
        return jsonify({"error": "Invalid action"}), 400

    return "", 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(http_port))
    