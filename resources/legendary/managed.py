"""Hydra protocol 1: exact-target access to the pinned, unmodified Legendary core.

Only this adapter opts into targeted behavior. The public Legendary CLI remains
unchanged for authentication, library synchronization, launch and cloud saves.
"""

import argparse
import hashlib
import json
import logging
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True

PROTOCOL_VERSION = 1
LEGENDARY_VERSION = "0.21.1"
LEGENDARY_REQUEST_TIMEOUT_SECONDS = 15
CAPABILITIES = ["inspect-target", "install-target", "access-only", "refresh-session", "install-components"]
SDL_MAX_PACKS = 64
SDL_MAX_TAGS = 64
SDL_ID_MAX_LENGTH = 64
SDL_NAME_MAX_LENGTH = 128
INSTALL_TAG_MAX_LENGTH = 128
IDENTITY = re.compile(r"[A-Za-z0-9_.-]{1,256}")
SDL_ID = re.compile(r"[A-Za-z0-9_.-]{1,%d}" % SDL_ID_MAX_LENGTH)
INSTALL_TAG = re.compile(r"[A-Za-z0-9_.-]{0,%d}" % INSTALL_TAG_MAX_LENGTH)


class ManagedError(Exception):
    pass


def private_path(value):
    absolute = os.path.abspath(value)
    if os.name == "nt" and not absolute.startswith("\\\\?\\"):
        absolute = "\\\\?\\UNC\\" + absolute[2:] if absolute.startswith("\\\\") else "\\\\?\\" + absolute
    return Path(absolute)


def path_identity(value):
    text = str(value)
    if os.name == "nt":
        if text.startswith("\\\\?\\UNC\\"):
            text = "\\\\" + text[8:]
        elif text.startswith("\\\\?\\"):
            text = text[4:]
        text = os.path.normcase(text)
    return Path(text)


def load_request(value):
    config = os.environ.get("LEGENDARY_CONFIG_PATH")
    if not isinstance(value, str) or not os.path.isabs(value) or not config or not os.path.isabs(config):
        raise ManagedError("invalid-request")
    workspace = private_path(config).resolve(strict=True)
    expected = workspace / "managed-request.json"
    supplied = private_path(value)
    if supplied.is_symlink() or supplied.is_junction() or path_identity(supplied.resolve()) != path_identity(expected) or not expected.is_file():
        raise ManagedError("invalid-request")
    # The CLI may identify only the parent's fixed request file. Never read an
    # arbitrary CLI path, even when it happens to contain valid protocol JSON.
    request = json.loads(expected.read_text(encoding="utf-8"))
    if not isinstance(request, dict) or request.get("protocolVersion") != PROTOCOL_VERSION or request.get("operation") not in ("inspect", "install", "refresh"):
        raise ManagedError("invalid-request")
    return workspace, request


def bootstrap(archive):
    root = Path(__file__).resolve().parent
    sys.path.insert(0, str(Path(archive).resolve()))
    sys.path.insert(0, str(root / "managed-native"))
    from legendary import __version__
    if __version__ != LEGENDARY_VERSION:
        raise ManagedError("runtime-mismatch")


def target_from_request(request, key="target"):
    target = request.get(key)
    if not isinstance(target, dict) or target.get("platform") != "Windows":
        raise ManagedError("unsupported-platform")
    for name in ("artifactId", "namespace", "catalogItemId"):
        if not isinstance(target.get(name), str) or not IDENTITY.fullmatch(target[name]):
            raise ManagedError("invalid-target")
    return target


def base_from_request(request):
    if request.get("base") is None:
        return None
    base = target_from_request(request, "base")
    if base["artifactId"] == request["target"]["artifactId"] or (base["namespace"], base["catalogItemId"]) == (request["target"]["namespace"], request["target"]["catalogItemId"]):
        raise ManagedError("invalid-target")
    return base


def initialize_access(core):
    # Never call login/resume_session: neither verification nor token rotation
    # belongs to this child. The parent owns the refresh generation and lease.
    user = core.lgd.userdata
    if not isinstance(user, dict) or not user.get("access_token") or not user.get("account_id"):
        raise ManagedError("authentication-required")
    try:
        expiry = datetime.fromisoformat(user["expires_at"].replace("Z", "+00:00"))
        if expiry <= datetime.now(timezone.utc):
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise ManagedError("authentication-expired") from None
    # Deliberately discard any refresh token even in an installation workspace.
    core.egs.user = {key: value for key, value in user.items() if key != "refresh_token"}
    core.egs.access_token = user["access_token"]
    core.egs.session.headers["Authorization"] = "bearer " + user["access_token"]
    core.logged_in = True
    core.login = lambda *args, **kwargs: True
    core.egs.start_session = lambda *args, **kwargs: denied()
    core.egs.resume_session = lambda *args, **kwargs: denied()
    # Preserve upstream API parameters and game workarounds from version.json.
    # This reads the local cache only and is also safe when no cache exists.
    core.apply_lgd_config()


def denied(*args, **kwargs):
    raise ManagedError("non-target-operation")


def error_code(error):
    if isinstance(error, ManagedError):
        return {
            "authentication-required": "session-expired",
            "authentication-expired": "session-expired",
            "invalid-target": "invalid-artifact",
            "invalid-metadata": "invalid-artifact",
            "unsupported-game": "not-installable",
            "preload-unavailable": "not-installable",
            "external-launcher-required": "external-launcher-required",
            "unsupported-platform": "not-installable",
            "update-required": "update-required",
            "base-not-installed": "installation-missing",
        }.get(str(error), "invalid-response")
    status = getattr(getattr(error, "response", None), "status_code", None)
    if status in (401, 403):
        return "session-expired"
    if status == 404:
        return "invalid-artifact"
    if status is not None:
        return "network"
    if type(error).__module__.startswith(("requests.", "urllib3.")):
        return "network"
    return "invalid-response"


def constrain_core(core, game, target, manifest, base_game=None):
    def exact_game(app_name, *args, **kwargs):
        if kwargs.get("platform", "Windows") != "Windows":
            raise ManagedError("invalid-target")
        if base_game is not None and app_name == base_game.app_name:
            return base_game
        if app_name != target["artifactId"]:
            raise ManagedError("invalid-target")
        return game

    core.get_game = exact_game
    core.get_assets = lambda *args, **kwargs: list(game.asset_infos.values())
    core.get_asset = lambda app_name, *args, **kwargs: exact_game(app_name).asset_infos["Windows"]
    core.get_dlc_for_game = lambda *args, **kwargs: []
    core.update_aliases = lambda *args, **kwargs: None
    for name in ("get_game_list", "get_game_and_dlc_list", "get_non_asset_library_items"):
        setattr(core, name, denied)
    for name in ("get_game_assets", "get_user_entitlements_full", "get_library_items", "get_game_achievements", "get_game_achievements_user"):
        setattr(core.egs, name, denied)

    def exact_manifest(requested, platform="Windows", disable_https=False):
        if requested.app_name != target["artifactId"] or platform != "Windows" or disable_https:
            raise ManagedError("invalid-target")
        return manifest

    core.get_cdn_manifest = exact_manifest


def validate_metadata(metadata, target, base=None):
    if not isinstance(metadata, dict) or metadata.get("namespace") != target["namespace"] or metadata.get("id") != target["catalogItemId"]:
        raise ManagedError("invalid-metadata")
    paths = [category.get("path", "") for category in metadata.get("categories", [])]
    if base is not None:
        validate_dlc_metadata(metadata, paths, base)
    elif target["namespace"] == "ue" or "mainGameItem" in metadata or not any(path == "games" or path.startswith("games/") for path in paths) or any(path == "addons" or path.startswith("addons/") for path in paths):
        raise ManagedError("unsupported-game")
    attributes = metadata.get("customAttributes", {})
    if any(attributes.get(name, {}).get("value") not in (None, "", "No", "false", False) for name in ("ThirdPartyManagedApp", "ThirdPartyManagedProvider", "partnerLinkType")):
        raise ManagedError("external-launcher-required")


def validate_dlc_metadata(metadata, paths, base):
    main = metadata.get("mainGameItem")
    releases = main.get("releaseInfo") if isinstance(main, dict) else None
    if not isinstance(main, dict) or main.get("id") != base["catalogItemId"] or main.get("namespace", base["namespace"]) != base["namespace"] or not isinstance(releases, list) or not releases or not isinstance(releases[0], dict) or releases[0].get("appId") != base["artifactId"]:
        raise ManagedError("unsupported-game")
    if base["namespace"] == "ue" or "addons" not in paths or "addons/launchable" in paths:
        raise ManagedError("unsupported-game")


def sdl_definition(core, artifact):
    from legendary.utils.selective_dl import get_sdl_appname, games
    name = get_sdl_appname(artifact)
    if name is None:
        return None
    try:
        data = core.lgdapi.get_sdl_config(name)
    except Exception:
        data = None
    if not valid_sdl(data):
        data = games.get(name)
    return data if valid_sdl(data) else None


def valid_sdl(data):
    if not isinstance(data, dict) or not data or len(data) > SDL_MAX_PACKS + 1:
        return False
    for key, pack in data.items():
        if not isinstance(key, str) or not SDL_ID.fullmatch(key) or not isinstance(pack, dict):
            return False
        tags, name = pack.get("tags"), pack.get("name")
        if not isinstance(tags, list) or not tags or len(tags) > SDL_MAX_TAGS or not all(isinstance(tag, str) and INSTALL_TAG.fullmatch(tag) for tag in tags):
            return False
        if not isinstance(name, str) or not name.strip() or len(name) > SDL_NAME_MAX_LENGTH:
            return False
    return any(key != "__required" for key in data)


def selective_packs(definition, parsed):
    required = set(definition.get("__required", {}).get("tags", []))
    chunks = {chunk.guid_num: chunk.file_size for chunk in parsed.chunk_data_list.elements}
    files = parsed.file_manifest_list.elements
    base_files = [file for file in files if not file.install_tags or required.intersection(file.install_tags)]
    optional_files = [file for file in files if file.install_tags and not required.intersection(file.install_tags)]
    base_chunks = {part.guid_num for file in base_files for part in file.chunk_parts}

    def sizes(selected):
        used = {part.guid_num for file in selected for part in file.chunk_parts} - base_chunks
        return sum(chunks.get(guid, 0) for guid in used), sum(file.file_size for file in selected)

    base_download = sum(chunks.get(guid, 0) for guid in base_chunks)
    packs = []
    for key, pack in definition.items():
        if key == "__required":
            continue
        tags = set(pack["tags"])
        download, disk = sizes([file for file in optional_files if tags.intersection(file.install_tags)])
        packs.append({"id": key, "name": pack["name"].strip(), "tags": list(pack["tags"]), "download_size": download, "disk_size": disk})
    return {"required_tags": sorted(required), "download_size": base_download, "disk_size": sum(file.file_size for file in base_files), "packs": packs}


def receipt_path(path, workspace):
    resolved = private_path(path).resolve()
    root = path_identity(workspace.resolve())
    normalized = path_identity(resolved)
    if not normalized.is_relative_to(root) or resolved.suffix != ".manifest":
        raise ManagedError("invalid-receipt")
    # Retain the workspace's long-path prefix for actual filesystem access.
    return workspace.resolve() / normalized.relative_to(root)


def cached_manifest(receipt, workspace, target, source_hash):
    if not isinstance(receipt, dict) or receipt.get("sourceHash") != source_hash:
        return None
    try:
        file = receipt_path(receipt["manifestPath"], workspace)
        data = file.read_bytes()
        state = json.loads(Path(str(file) + ".json").read_text(encoding="utf-8"))
        # SHA-1 is Epic's manifest wire identifier, never our security digest;
        # cached bytes must independently match the parent's SHA-256 receipt.
        if state["target"] != target or state["sourceHash"] != source_hash or hashlib.sha256(data).hexdigest() != receipt["sha256"] or hashlib.sha1(data, usedforsecurity=False).hexdigest() != source_hash:
            return None
        return data
    except (OSError, KeyError, TypeError, ValueError):
        return None


def inspect_target(core, request, workspace):
    from legendary.models.game import Game, GameAsset

    target = target_from_request(request)
    base = base_from_request(request)
    # Both calls concern one authorized item. No assets/library/achievement call.
    with ThreadPoolExecutor(max_workers=2) as executor:
        metadata_future = executor.submit(core.egs.get_game_info, target["namespace"], target["catalogItemId"])
        descriptor_future = executor.submit(core.egs.get_game_manifest, target["namespace"], target["catalogItemId"], target["artifactId"], target["platform"])
        metadata, descriptor = metadata_future.result(), descriptor_future.result()
    validate_metadata(metadata, target, base)
    elements = descriptor.get("elements", [])
    if len(elements) != 1:
        raise ManagedError("invalid-manifest")
    element = elements[0]
    # Descriptor identity is checked before any cached manifest can be reused.
    for key, expected in (("appName", target["artifactId"]), ("catalogItemId", target["catalogItemId"]), ("namespace", target["namespace"]), ("platform", target["platform"])):
        if key in element and element[key] != expected:
            raise ManagedError("invalid-manifest")
    source_hash = element.get("hash", "")
    if not isinstance(source_hash, str) or not re.fullmatch(r"[0-9a-fA-F]{40}", source_hash):
        raise ManagedError("invalid-manifest")
    source_hash = source_hash.lower()
    if element.get("isPreloaded"):
        raise ManagedError("preload-unavailable")
    game = Game(app_name=target["artifactId"], app_title=metadata.get("title", target["artifactId"]), metadata=metadata)
    # Let upstream construct CDN query strings and validate the source SHA-1.
    original_manifest = core.egs.get_game_manifest
    core.egs.get_game_manifest = lambda *args, **kwargs: descriptor
    try:
        urls, base_urls, _, _, secrets = core.get_cdn_urls(game, target["platform"])
        data = cached_manifest(request.get("receipt"), workspace, target, source_hash)
        if data is None:
            data, base_urls, _, secrets = core.get_cdn_manifest(game, target["platform"])
    finally:
        core.egs.get_game_manifest = original_manifest
    if not urls or not base_urls:
        raise ManagedError("invalid-manifest")
    parsed = core.load_manifest(data)
    if not parsed.decrypt(secrets):
        raise ManagedError("manifest-decryption-failed")
    # Epic can rename an artifact while retaining the manifest's original app
    # name (for example Deliver Us Mars). Only the freshly authenticated Epic
    # descriptor may attest that alias; its SHA-1 still binds the actual bytes.
    if not parsed.meta.build_version or (parsed.meta.app_name != target["artifactId"] and element.get("appName") != target["artifactId"]):
        raise ManagedError("invalid-manifest")
    if request.get("operation") == "install" and request.get("receipt") is not None:
        expected = request["receipt"]
        if not isinstance(expected, dict):
            raise ManagedError("invalid-receipt")
        if expected.get("version") != parsed.meta.build_version or expected.get("sourceHash") != source_hash:
            # Preparation was for a different build, even if the publisher
            # reused the version string. Stop before invoking the downloader.
            raise ManagedError("update-required")
    game.asset_infos = {"Windows": GameAsset(app_name=target["artifactId"], namespace=target["namespace"], catalog_item_id=target["catalogItemId"], build_version=parsed.meta.build_version, label_name="Live")}
    game.base_urls = base_urls
    core.lgd.set_game_meta(game.app_name, game)
    # Keep original encrypted bytes, source digest and keys in the private
    # workspace, so install uses upstream decrypt() rather than an override URI.
    directory = workspace / "managed-manifests"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    file = directory / (hashlib.sha256(target["artifactId"].encode()).hexdigest() + ".manifest")
    file.write_bytes(data)
    os.chmod(file, 0o600)
    receipt = dict(manifestPath=str(file), sha256=hashlib.sha256(data).hexdigest(), sourceHash=source_hash, version=parsed.meta.build_version)
    state_file = Path(str(file) + ".json")
    state_file.write_text(json.dumps(dict(target=target, sourceHash=source_hash, version=parsed.meta.build_version)), encoding="utf-8")
    os.chmod(state_file, 0o600)
    info = dict(game=dict(app_name=game.app_name, version=parsed.meta.build_version, is_dlc=game.is_dlc, external_activation=game.third_party_store or game.partner_link_type, cloud_saves_supported=game.supports_cloud_saves or game.supports_mac_cloud_saves), manifest=dict(is_preloaded=False, download_size=sum(chunk.file_size for chunk in parsed.chunk_data_list.elements), disk_size=sum(file.file_size for file in parsed.file_manifest_list.elements)), install=None)
    if base is None and (definition := sdl_definition(core, target["artifactId"])):
        info["sdl"] = selective_packs(definition, parsed)
    return dict(protocolVersion=PROTOCOL_VERSION, info=info, metadata=game.__dict__, receipt=receipt), game, (data, base_urls, False, secrets)


def installed_base_game(core, base):
    if base is None:
        return None
    game = core.lgd.get_game_meta(base["artifactId"])
    metadata = getattr(game, "metadata", None)
    if game is None or not isinstance(metadata, dict) or metadata.get("namespace") != base["namespace"] or metadata.get("id") != base["catalogItemId"] or "Windows" not in (game.asset_infos or {}):
        raise ManagedError("invalid-target")
    if not core.is_installed(base["artifactId"]):
        raise ManagedError("base-not-installed")
    return game


def run_install(core, request, game, manifest):
    import legendary.cli as cli

    args = request.get("args", [])
    if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
        raise ManagedError("invalid-request")
    args = [arg for arg in args if arg not in ("--skip-dlcs", "--skip-sdl")]
    target = request["target"]
    if "install" not in args or args[args.index("install") + 1:args.index("install") + 2] != [target["artifactId"]]:
        raise ManagedError("invalid-target")
    # Prevent a request from overriding the validated manifest, identity, API
    # context or transport. Args come from the trusted main process only.
    forbidden = ("--manifest", "--old-manifest", "--delta-manifest", "--base-url", "--disable-https", "--config-file", "-c", "--debug", "-v", "--with-dlcs", "--reset-sdl")
    if any(arg.split("=", 1)[0] in forbidden for arg in args):
        raise ManagedError("invalid-request")
    for arg in args:
        if arg.startswith("--install-tag") and (not arg.startswith("--install-tag=") or not INSTALL_TAG.fullmatch(arg.split("=", 1)[1])):
            raise ManagedError("invalid-request")
    base_game = installed_base_game(core, base_from_request(request))
    constrain_core(core, game, target, manifest, base_game)
    original_cli = cli.LegendaryCLI

    class TargetedCLI(original_cli):
        def __init__(self, *args, **kwargs):
            self.core = core
            self.logger = logging.getLogger("cli")
            self.logging_queue = None

        def _resolve_aliases(self, name):
            if name != target["artifactId"]:
                raise ManagedError("invalid-target")
            return name

    cli.LegendaryCLI = TargetedCLI
    sys.argv = ["hydra-legendary", *args, "--skipdlcs", "--disable-sdl", "--platform", "Windows"]
    cli.main()


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("archive")
    parser.add_argument("--request")
    parser.add_argument("--capabilities", action="store_true")
    args = parser.parse_args()
    bootstrap(args.archive)
    if args.capabilities:
        print(json.dumps(dict(protocolVersion=PROTOCOL_VERSION, legendaryVersion=LEGENDARY_VERSION, capabilities=CAPABILITIES)))
        return
    workspace, request = load_request(args.request)
    from legendary.core import LegendaryCore
    # Upstream may log URLs on network failures. Parent gets only the adapter's
    # fixed error code; progress output is enabled after authenticated queries.
    logging.disable(logging.CRITICAL)
    core = LegendaryCore(timeout=LEGENDARY_REQUEST_TIMEOUT_SECONDS)
    try:
        if request["operation"] == "refresh":
            # Only the parent's central credential lease invokes this mode.
            # Unlike `status`, it never enumerates library/assets/achievements.
            core.update_check_enabled = lambda: False
            core.is_overlay_installed = lambda: False
            if not core.login(force_refresh=True):
                raise ManagedError("authentication-required")
            print(json.dumps(dict(protocolVersion=PROTOCOL_VERSION)))
            return
        initialize_access(core)
        result, game, manifest = inspect_target(core, request, workspace)
        if request["operation"] == "inspect":
            print(json.dumps(result))
        else:
            logging.disable(logging.NOTSET)
            logging.getLogger().setLevel(logging.INFO)
            run_install(core, request, game, manifest)
    finally:
        core.exit()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as error:
        print("HYDRA_MANAGED_ERROR:" + error_code(error), file=sys.stderr)
        sys.exit(1)
