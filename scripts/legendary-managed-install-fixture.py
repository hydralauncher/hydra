"""Offline integration: real pinned CLI, manifest analysis, workers and install record."""

import argparse
import hashlib
import http.server
import importlib.util
import json
import os
import platform
import re
import subprocess
import sys
import tempfile
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit


def runtime_directory():
    architecture = {"amd64": "x64", "x86_64": "x64", "arm64": "arm64", "aarch64": "arm64"}.get(platform.machine().lower())
    if architecture is None:
        raise ValueError("Unsupported fixture runtime architecture")
    return Path(__file__).resolve().parents[1] / "legendary" / sys.platform / architecture


def fixture_directory(value):
    base = Path(tempfile.gettempdir()).resolve()
    supplied = Path(value)
    resolved = supplied.resolve(strict=True)
    if supplied.is_symlink() or supplied.is_junction() or resolved.parent != base or not re.fullmatch(r"hydra-real-install-[a-z0-9_]{8}", resolved.name):
        raise ValueError("Invalid isolated fixture directory")
    return base / resolved.name


def loopback_url(value):
    parsed = urlsplit(value)
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or not parsed.port or value != "http://127.0.0.1:" + str(parsed.port):
        raise ValueError("Invalid fixture loopback URL")
    return value


def bootstrap(root):
    spec = importlib.util.spec_from_file_location("managed", root / "managed.py")
    managed = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(managed)
    managed.bootstrap(root / "managed-legendary.pyz")
    return managed


def generate(root, directory):
    bootstrap(root)
    from legendary.models.chunk import Chunk
    from legendary.models.manifest import Manifest, ManifestMeta, CDL, FML, CustomFields, ChunkInfo, FileManifest, ChunkPart
    files = {"game.exe": b"Offline synthetic game fixture\n", "setup.exe": b"Never execute this synthetic prerequisite\n"}
    payload = b"".join(files.values())
    chunk = Chunk()
    chunk.guid = (1, 2, 3, 4)
    chunk.data = payload
    data = chunk.write()
    info = ChunkInfo()
    info.guid, info.hash, info.sha_hash = chunk.guid, chunk.hash, chunk.sha_hash
    info.window_size, info.file_size = 1024 * 1024, len(data)
    chunk_file = directory / info.path
    chunk_file.parent.mkdir(parents=True)
    chunk_file.write_bytes(data)
    manifest = Manifest()
    manifest.meta = ManifestMeta()
    manifest.meta.app_name = "Example"
    manifest.meta.build_version = "fixture-1"
    manifest.meta.launch_exe = "game.exe"
    manifest.meta.launch_command = "--fixture"
    manifest.meta.prereq_ids = ["fixture-prereq"]
    manifest.meta.prereq_name = "Fixture prerequisite"
    manifest.meta.prereq_path = "setup.exe"
    manifest.meta.prereq_args = "/quiet"
    manifest.chunk_data_list = CDL()
    manifest.chunk_data_list.elements = [info]
    manifest.chunk_data_list.count = 1
    manifest.file_manifest_list = FML()
    offset = 0
    for name, content in files.items():
        file = FileManifest()
        file.filename = name
        # Epic's file format requires SHA-1; these bytes are synthetic fixtures.
        file.hash = hashlib.sha1(content, usedforsecurity=False).digest()
        file.chunk_parts = [ChunkPart(guid=chunk.guid, offset=offset, size=len(content))]
        file.file_size = len(content)
        offset += len(content)
        manifest.file_manifest_list.elements.append(file)
    manifest.file_manifest_list.count = len(files)
    manifest.custom_fields = CustomFields()
    (directory / "manifest").write_bytes(manifest.write())
    return files


def worker(root, directory, url):
    fixtures = directory / "cdn"
    workspace = directory / "workspace"
    destination = directory / "Downloads"
    for child in (fixtures, workspace, destination):
        if child.is_symlink() or child.is_junction() or child.resolve().parent != directory:
            raise ValueError("Fixture child escapes isolated directory")
    os.environ["LEGENDARY_CONFIG_PATH"] = str(workspace)
    workspace.mkdir(mode=0o700)
    expiry = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    (workspace / "config.ini").write_text("[Legendary]\ndisable_update_check=true\ndisable_update_notice=true\ndisable_auto_aliasing=true\nmax_memory=64\nmax_workers=1\n")
    (workspace / "user.json").write_text(json.dumps(dict(account_id="a" * 32, access_token="synthetic", displayName="Offline fixture", expires_at=expiry)))
    (workspace / "version.json").write_text(json.dumps(dict(data={})))
    managed = bootstrap(root)
    from legendary.core import LegendaryCore
    import requests
    original_request = requests.Session.request
    def offline_request(self, method, address, *args, **kwargs):
        if not address.startswith(url + "/"):
            raise AssertionError("Unexpected external HTTP request: " + address.split("?")[0])
        return original_request(self, method, address, *args, **kwargs)
    requests.Session.request = offline_request
    core = LegendaryCore()
    managed.initialize_access(core)
    target = dict(artifactId="Example", namespace="namespace", catalogItemId="item", platform="Windows")
    metadata = dict(id="item", namespace="namespace", title="Offline fixture", categories=[dict(path="games")], customAttributes=dict(CanRunOffline=dict(value="false"), OwnershipToken=dict(value="true")))
    data = (fixtures / "manifest").read_bytes()
    element = dict(appName="Example", namespace="namespace", catalogItemId="item", platform="Windows", hash=hashlib.sha1(data, usedforsecurity=False).hexdigest(), manifests=[dict(uri=url + "/manifest")])
    core.egs.get_game_info = lambda namespace, item: metadata
    core.egs.get_game_manifest = lambda namespace, item, artifact, platform: dict(elements=[element])
    request = dict(protocolVersion=1, operation="install", target=target, args=["-y", "install", "Example", "--platform", "Windows", "--base-path", str(destination), "--game-folder", "Espaço Game", "--skip-dlcs", "--skip-sdl"])
    result, game, manifest = managed.inspect_target(core, request, workspace)
    request["receipt"] = result["receipt"]
    for key, stale_value in (("version", "stale-build"), ("sourceHash", "0" * 40)):
        stale = dict(request, receipt={**request["receipt"], key: stale_value})
        try:
            managed.inspect_target(core, stale, workspace)
        except managed.ManagedError as error:
            assert managed.error_code(error) == "update-required"
        else:
            raise AssertionError("A changed build reached the install boundary")
        assert not destination.exists()
        assert core.lgd.get_installed_game("Example") is None
    try:
        managed.run_install(core, request, game, manifest)
    except SystemExit as error:
        if error.code != 0:
            raise
    installed = core.lgd.get_installed_game("Example")
    if installed is None:
        raise AssertionError("CLI returned without creating the installed-game record")
    assert installed.version == "fixture-1"
    assert installed.executable == "game.exe"
    assert installed.launch_parameters == "--fixture"
    assert installed.requires_ot is True
    assert installed.can_run_offline is False
    assert installed.prereq_info["ids"] == ["fixture-prereq"]
    assert installed.prereq_info["path"] == "setup.exe"
    for name, content in {"game.exe": b"Offline synthetic game fixture\n", "setup.exe": b"Never execute this synthetic prerequisite\n"}.items():
        assert (destination / "Espaço Game" / name).read_bytes() == content
    print("OFFLINE_REAL_INSTALL_OK " + json.dumps(dict(version=installed.version, executable=installed.executable, requires_ot=installed.requires_ot, prerequisites=installed.prereq_info)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", nargs=2, metavar=("DIRECTORY", "URL"))
    args = parser.parse_args()
    root = runtime_directory()
    if args.worker:
        worker(root, fixture_directory(args.worker[0]), loopback_url(args.worker[1]))
        return
    with tempfile.TemporaryDirectory(prefix="hydra-real-install-") as temporary:
        directory = Path(temporary)
        os.chmod(directory, 0o700)
        fixtures = directory / "cdn"
        fixtures.mkdir(mode=0o700)
        generate(root, fixtures)
        from functools import partial
        requests_seen = []
        class Handler(http.server.SimpleHTTPRequestHandler):
            def do_GET(self):
                requests_seen.append(self.path)
                super().do_GET()

            def log_message(self, *_args):
                pass
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(fixtures)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            result = subprocess.run([sys.executable, "-I", "-B", str(Path(__file__).resolve()), "--worker", str(directory), "http://127.0.0.1:" + str(server.server_address[1])], shell=False, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=45)
            print(result.stdout)
            print(result.stderr, file=sys.stderr)
            if result.returncode == 0:
                assert "/manifest" in requests_seen
                assert any(path.endswith(".chunk") for path in requests_seen)
                assert all(path == "/manifest" or path.endswith(".chunk") for path in requests_seen)
            sys.exit(result.returncode)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    main()
