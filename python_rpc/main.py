from flask import Flask, request, jsonify
import sys, json, urllib.parse, psutil
from torrent_downloader import TorrentDownloader
from http_downloader import HttpDownloader
from profile_image_processor import ProfileImageProcessor
import libtorrent as lt

app = Flask(__name__)

# Retrieve command line arguments
torrent_port = sys.argv[1]
http_port = sys.argv[2]
rpc_password = sys.argv[3]

downloads = {}
# This can be streamed down from Node
downloading_game_id = -1

torrent_session = lt.session({'listen_interfaces': '0.0.0.0:{port}'.format(port=torrent_port)})

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
    if downloader:
        status = downloads.get(downloading_game_id).get_download_status()
        return jsonify(status), 200
    else:
        return jsonify(None)

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

        if response.get('status') == 5:
            seed_status.append({
                'gameId': game_id,
                **response,
            })

    return jsonify(seed_status), 200

@app.route("/healthcheck", methods=["GET"])
def healthcheck():
    return "", 200

@app.route("/process-list", methods=["GET"])
def process_list():
    auth_error = validate_rpc_password()
    if auth_error:
        return auth_error

    process_list = [proc.info for proc in psutil.process_iter(['exe', 'pid', 'username'])]
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

    print(data)

    if action == 'start':
        url = data.get('url')

        existing_downloader = downloads.get(game_id)

        if existing_downloader:
            # This will resume the download
            existing_downloader.start_download(url, data['save_path'], data.get('header'))
        else:
            if url.startswith('magnet'):
                torrent_downloader = TorrentDownloader(torrent_session)
                downloads[game_id] = torrent_downloader
                torrent_downloader.start_download(url, data['save_path'], "")
            else:
                http_downloader = HttpDownloader()
                downloads[game_id] = http_downloader
                http_downloader.start_download(url, data['save_path'], data.get('header'))
        
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

    # elif action == 'kill-torrent':
    #     torrent_downloader.abort_session()
    #     torrent_downloader = None
    # elif action == 'pause-seeding':
    #     torrent_downloader.pause_seeding(game_id)
    # elif action == 'resume-seeding':
    #     torrent_downloader.resume_seeding(game_id, data['url'], data['save_path'])
    else:
        return jsonify({"error": "Invalid action"}), 400

    return "", 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(http_port))
    