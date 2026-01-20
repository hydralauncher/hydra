from flask import Flask, request, jsonify
import sys, json, urllib.parse, psutil, socket
from torrent_downloader import TorrentDownloader
from http_downloader import HttpDownloader
from profile_image_processor import ProfileImageProcessor
import libtorrent as lt

RPC_PORT_MIN = 8080
RPC_PORT_MAX = 9000

def find_available_port(preferred_port, start=RPC_PORT_MIN, end=RPC_PORT_MAX):
    """Find an available port, trying the preferred port first."""
    # Try preferred port first
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('0.0.0.0', preferred_port))
            return preferred_port
    except OSError:
        pass
    
    # Try ports in range
    for port in range(start, end + 1):
        if port == preferred_port:
            continue
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('0.0.0.0', port))
                return port
        except OSError:
            continue
    
    raise RuntimeError(f"No available ports in range {start}-{end}")

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
    
    if initial_download['url'].startswith('magnet'):
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
            http_downloader.start_download(initial_download['url'], initial_download['save_path'], initial_download.get('header'), initial_download.get('out'))
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
        
        if response.get('status') == 5:  # Torrent seeding check
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
    
    iter_list  = ['exe', 'pid', 'name']
    if sys.platform != 'win32':
        iter_list.append('cwd')
        iter_list.append('environ')

    process_list = [proc.info for proc in psutil.process_iter(iter_list)]
    return jsonify(process_list), 200

@app.route("/profile-image", methods=["POST"])
def profile_image():
    auth_error = validate_rpc_password()
    if auth_error:
        return auth_error

    data = request.get_json()
    image_path = data.get('image_path')

    # use webp as default value for target_extension
    target_extension = data.get('target_extension') or 'webp'

    try:
        processed_image_path, mime_type = ProfileImageProcessor.process_image(image_path, target_extension)
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

        if url.startswith('magnet'):
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
        
        if downloading_game_id == game_id:
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
    actual_port = find_available_port(int(http_port))
    # Print port for Node.js to capture - must be flushed immediately
    print(f"RPC_PORT:{actual_port}", flush=True)
    app.run(host="0.0.0.0", port=actual_port)
