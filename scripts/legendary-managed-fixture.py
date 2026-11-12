"""Offline adapter regressions using the actual pinned parser, AES and CDN hash check."""
import copy
import hashlib
import importlib.util
import io
import json
import logging
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

root = Path(sys.argv.pop(1)).resolve()
spec = importlib.util.spec_from_file_location("managed", root / "managed.py")
managed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(managed)
managed.bootstrap(root / "managed-legendary.pyz")
from Cryptodome.Cipher import AES
from legendary.core import LegendaryCore
from legendary.models.manifest import Manifest, ManifestMeta, CDL, FML, CustomFields, ChunkInfo, FileManifest, ChunkPart, EncryptedData, write_fstring

TARGET = dict(artifactId="Example", namespace="namespace", catalogItemId="item", platform="Windows")


def manifest_bytes(version="1", encrypted=False, app_name="Example"):
    manifest = Manifest()
    manifest.meta = ManifestMeta()
    manifest.meta.app_name = app_name
    manifest.meta.build_version = version
    manifest.meta.launch_exe = "game.exe"
    manifest.meta.prereq_ids = ["prereq"]
    manifest.meta.prereq_path = "setup.exe"
    manifest.meta.prereq_name = "Dependencies"
    manifest.meta.prereq_args = "/quiet"
    manifest.chunk_data_list = CDL()
    chunk = ChunkInfo()
    chunk.guid = (1, 2, 3, 4)
    chunk.file_size = 123
    chunk.sha_hash = bytes(20)
    manifest.chunk_data_list.elements = [chunk]
    manifest.chunk_data_list.count = 1
    manifest.file_manifest_list = FML()
    file = FileManifest()
    file.filename = "game.exe"
    file.hash = bytes(20)
    part = ChunkPart()
    part.guid = chunk.guid
    part.offset = 0
    part.size = 456
    file.chunk_parts = [part]
    file.file_size = 456
    manifest.file_manifest_list.elements = [file]
    manifest.file_manifest_list.count = 1
    manifest.custom_fields = CustomFields()
    secrets = {}
    if encrypted:
        payload = io.BytesIO()
        for value in ("game.exe", ""):
            write_fstring(payload, value)
        payload.write(struct.pack("<I", 1))
        for value in ("prereq", "Dependencies", "setup.exe", "/quiet", "", "", "game.exe", ""):
            write_fstring(payload, value)
        key = bytes(range(32))
        iv = bytes(range(12))
        cipher = AES.new(key, AES.MODE_GCM, nonce=iv)
        ciphertext, tag = cipher.encrypt_and_digest(payload.getvalue())
        manifest.meta.feature_level = 24
        manifest.chunk_data_list._manifest_version = 24
        chunk.secret_guid = (0, 0, 0, 0)
        chunk.encryption_tag = bytes(16)
        manifest.header_size = 73
        manifest.stored_as = 2
        manifest.secret_guid = (1, 2, 3, 4)
        manifest.encryption_tag = tag
        manifest.encrypted_data = EncryptedData()
        manifest.encrypted_data.encrypted_header.iv = iv
        manifest.encrypted_data.ciphertext = ciphertext
        manifest.meta.launch_exe = ""
        file.filename = ""
        secrets = {"00000001000000020000000300000004": key.hex()}
    return manifest.write(), secrets


def tagged_manifest_bytes():
    manifest = Manifest()
    manifest.meta = ManifestMeta()
    manifest.meta.app_name = "Example"
    manifest.meta.build_version = "1"
    manifest.meta.launch_exe = "game.exe"
    manifest.chunk_data_list = CDL()
    manifest.file_manifest_list = FML()
    manifest.custom_fields = CustomFields()
    chunks = {}
    for index, size in enumerate((100, 20, 30, 40, 50), start=1):
        chunk = ChunkInfo()
        chunk.guid = (index, 0, 0, 0)
        chunk.file_size = size
        chunk.sha_hash = bytes(20)
        chunks[index] = chunk
    manifest.chunk_data_list.elements = list(chunks.values())
    manifest.chunk_data_list.count = len(chunks)
    for name, tags, guids, size in (("game.exe", [], [1], 1000), ("core.pak", ["chunk0"], [1, 2], 200), ("de.pak", ["voice_de"], [3, 1], 300), ("shared.pak", ["voice_de", "voice_fr"], [4], 400), ("fr.pak", ["voice_fr"], [5], 500)):
        file = FileManifest()
        file.filename = name
        file.hash = bytes(20)
        file.install_tags = tags
        file.file_size = size
        file.chunk_parts = []
        for guid in guids:
            part = ChunkPart()
            part.guid = chunks[guid].guid
            part.offset = 0
            part.size = size // len(guids)
            file.chunk_parts.append(part)
        manifest.file_manifest_list.elements.append(file)
    manifest.file_manifest_list.count = len(manifest.file_manifest_list.elements)
    return manifest.write()


SDL = {
    "__required": dict(tags=["chunk0"], name="Core"),
    "de": dict(tags=["voice_de"], name="Deutsch"),
    "fr": dict(tags=["voice_fr"], name="Français"),
}
DLC = dict(artifactId="ExampleDlc", namespace="namespace", catalogItemId="dlc", platform="Windows")
DLC_METADATA = dict(id="dlc", namespace="namespace", title="Example DLC", categories=[dict(path="addons")], mainGameItem=dict(id="item", namespace="namespace", releaseInfo=[dict(appId="Example")]))


class Fixture:
    def __init__(self, data, secrets=None):
        self.data = data
        self.calls = []
        self.metadata = dict(id="item", namespace="namespace", title="Example", categories=[dict(path="games")])
        self.element = dict(appName="Example", namespace="namespace", catalogItemId="item", platform="Windows", hash=hashlib.sha1(data, usedforsecurity=False).hexdigest(), manifests=[dict(uri="https://cdn.example/game/manifest")], secrets=secrets or {})
        self.core = LegendaryCore.__new__(LegendaryCore)
        self.core.log = logging.getLogger("test")
        self.core.lgd = SimpleNamespace(set_game_meta=lambda *args: self.calls.append("write-target"))
        self.core.egs = SimpleNamespace(get_game_info=self.catalog, get_game_manifest=self.descriptor, unauth_session=SimpleNamespace(get=self.cdn))

    def catalog(self, namespace, item):
        assert (namespace, item) == ("namespace", "item")
        self.calls.append("catalog-target")
        return copy.deepcopy(self.metadata)

    def descriptor(self, namespace, item, artifact, platform):
        assert (namespace, item, artifact, platform) == ("namespace", "item", "Example", "Windows")
        self.calls.append("manifest-target")
        return dict(elements=[copy.deepcopy(self.element)])

    def cdn(self, url, **kwargs):
        assert url == "https://cdn.example/game/manifest"
        self.calls.append("cdn-target")
        return SimpleNamespace(status_code=200, content=self.data)


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.workspace = Path(self.temporary.name)
        self.fixture = Fixture(manifest_bytes()[0])
        self.request = dict(protocolVersion=1, operation="inspect", target=TARGET)

    def inspect(self):
        return managed.inspect_target(self.fixture.core, self.request, self.workspace)

    def test_only_target_and_actual_parser(self):
        result, game, manifest = self.inspect()
        self.assertEqual(result["info"]["manifest"], dict(is_preloaded=False, download_size=123, disk_size=456))
        self.assertEqual(result["info"]["game"]["version"], "1")
        self.assertEqual(game.app_name, "Example")
        self.assertEqual(json.loads(json.dumps(result))["metadata"]["asset_infos"]["Windows"]["catalog_item_id"], "item")
        self.assertEqual(sorted(self.fixture.calls), ["catalog-target", "cdn-target", "manifest-target", "write-target"])

    def test_request_file_is_fixed_to_private_workspace_and_not_a_link(self):
        request_file = self.workspace / "managed-request.json"
        request_file.write_text(json.dumps(self.request), encoding="utf-8")
        nested = self.workspace / "nested"
        nested.mkdir()
        (nested / "managed-request.json").write_text(json.dumps(self.request), encoding="utf-8")
        with patch.dict(os.environ, LEGENDARY_CONFIG_PATH=str(self.workspace)):
            workspace, request = managed.load_request(str(request_file))
            self.assertEqual(managed.path_identity(workspace), self.workspace.resolve())
            self.assertEqual(request, self.request)
            for candidate in ("managed-request.json", self.workspace / "other.json", nested / "managed-request.json", self.workspace.parent / "managed-request.json"):
                with self.assertRaisesRegex(managed.ManagedError, "invalid-request"):
                    managed.load_request(str(candidate))
            with patch.object(Path, "is_symlink", return_value=True):
                with self.assertRaisesRegex(managed.ManagedError, "invalid-request"):
                    managed.load_request(str(request_file))

    def test_request_protocol_must_be_an_object(self):
        request_file = self.workspace / "managed-request.json"
        with patch.dict(os.environ, LEGENDARY_CONFIG_PATH=str(self.workspace)):
            for value in ([], None, "inspect", dict(protocolVersion=2, operation="inspect")):
                request_file.write_text(json.dumps(value), encoding="utf-8")
                with self.assertRaisesRegex(managed.ManagedError, "invalid-request"):
                    managed.load_request(str(request_file))

    def test_real_install_fixture_validates_runtime_workspace_and_loopback(self):
        spec = importlib.util.spec_from_file_location("install_fixture", Path(__file__).with_name("legendary-managed-install-fixture.py"))
        fixture = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fixture)
        self.assertEqual(fixture.runtime_directory().resolve(), root)
        base = Path(fixture.__file__).resolve().parents[1] / "legendary" / sys.platform
        for machine, architecture in (("AMD64", "x64"), ("x86_64", "x64"), ("ARM64", "arm64"), ("aarch64", "arm64")):
            with patch.object(fixture.platform, "machine", return_value=machine):
                self.assertEqual(fixture.runtime_directory(), base / architecture)
        with patch.object(fixture.platform, "machine", return_value="../outside"):
            with self.assertRaises(ValueError):
                fixture.runtime_directory()
        with patch.object(sys, "argv", [fixture.__file__, str(self.workspace)]), patch.object(sys, "stderr", io.StringIO()):
            with self.assertRaises(SystemExit) as rejected:
                fixture.main()
            self.assertEqual(rejected.exception.code, 2)
        with tempfile.TemporaryDirectory(prefix="hydra-real-install-") as directory:
            self.assertEqual(fixture.fixture_directory(directory), Path(directory).resolve())
            nested = Path(directory) / "hydra-real-install-abcdefgh"
            nested.mkdir()
            with self.assertRaises(ValueError):
                fixture.fixture_directory(str(nested))
        with self.assertRaises(ValueError):
            fixture.fixture_directory(str(self.workspace))
        self.assertEqual(fixture.loopback_url("http://127.0.0.1:12345"), "http://127.0.0.1:12345")
        for address in ("http://example.com:12345", "http://127.0.0.1:12345/path", "http://127.0.0.1:12345?query", "http://user@127.0.0.1:12345", "https://127.0.0.1:12345"):
            with self.assertRaises(ValueError):
                fixture.loopback_url(address)

    def test_cache_reuses_bytes_but_fresh_flags_and_descriptor(self):
        result, _, _ = self.inspect()
        self.request["receipt"] = result["receipt"]
        self.fixture.calls.clear()
        self.inspect()
        self.assertEqual(sorted(self.fixture.calls), ["catalog-target", "manifest-target", "write-target"])
        self.fixture.metadata["mainGameItem"] = {}
        with self.assertRaisesRegex(managed.ManagedError, "unsupported-game"):
            self.inspect()

    @unittest.skipUnless(sys.platform == "win32", "Windows long-path namespace")
    def test_namespaced_workspace_reuses_ordinary_receipt(self):
        result, _, _ = self.inspect()
        self.request["receipt"] = result["receipt"]
        self.fixture.calls.clear()
        self.workspace = Path("\\\\?\\" + str(self.workspace))
        self.inspect()
        self.assertNotIn("cdn-target", self.fixture.calls)

    @unittest.skipUnless(sys.platform == "win32", "Windows long request path")
    def test_actual_process_reads_request_beyond_windows_legacy_limit(self):
        ordinary = self.workspace / ("a" * 80) / ("b" * 80) / ("c" * 80)
        directory = managed.private_path(str(ordinary))
        directory.mkdir(parents=True)
        self.assertTrue(str(directory).startswith(str(managed.private_path(str(self.workspace))) + os.sep))
        self.addCleanup(shutil.rmtree, directory)
        (directory / "config.ini").write_text("[Legendary]\ndisable_update_check=true\n", encoding="utf-8")
        (directory / "managed-request.json").write_text(json.dumps(self.request), encoding="utf-8")
        request = str(ordinary / "managed-request.json")
        self.assertGreater(len(request), 260)
        result = subprocess.run([sys.executable, "-I", "-B", str(root / "managed.py"), str(root / "managed-legendary.pyz"), "--request", request], capture_output=True, text=True, timeout=10, env={**os.environ, "LEGENDARY_CONFIG_PATH": str(directory)})
        self.assertEqual(result.returncode, 1)
        self.assertIn("HYDRA_MANAGED_ERROR:session-expired", result.stderr)

    def test_changed_version_downloads_new_manifest(self):
        self.request["receipt"] = self.inspect()[0]["receipt"]
        self.fixture = Fixture(manifest_bytes("2")[0])
        self.assertEqual(self.inspect()[0]["info"]["game"]["version"], "2")
        self.assertIn("cdn-target", self.fixture.calls)

    def test_legacy_embedded_name_requires_fresh_exact_epic_alias_attestation(self):
        self.fixture = Fixture(manifest_bytes(app_name="OriginalArtifactName")[0])
        self.assertEqual(self.inspect()[0]["info"]["game"]["app_name"], "Example")
        self.fixture.element.pop("appName")
        with self.assertRaisesRegex(managed.ManagedError, "invalid-manifest"):
            self.inspect()

    def test_install_build_drift_stops_actual_entry_before_cli_invocation(self):
        from legendary import core as upstream_core
        for version, embedded_name in (("2", "Example"), ("1", "LegacyArtifactName")):
            self.fixture = Fixture(manifest_bytes()[0])
            self.request = dict(protocolVersion=1, operation="inspect", target=TARGET)
            receipt = self.inspect()[0]["receipt"]
            self.request.update(operation="install", receipt=receipt, args=["-y", "install", "Example"])
            self.fixture = Fixture(manifest_bytes(version=version, app_name=embedded_name)[0])
            self.fixture.core.exit = lambda: None
            request_file = self.workspace / "managed-request.json"
            request_file.write_text(json.dumps(self.request), encoding="utf-8")
            with patch.object(managed, "bootstrap"), patch.object(managed, "initialize_access"), patch.object(upstream_core, "LegendaryCore", return_value=self.fixture.core), patch.object(managed, "run_install") as transfer, patch.object(sys, "argv", ["managed", "unused.pyz", "--request", str(request_file)]), patch.dict(os.environ, LEGENDARY_CONFIG_PATH=str(self.workspace)):
                with self.assertRaisesRegex(managed.ManagedError, "update-required"):
                    managed.main()
                transfer.assert_not_called()

    def test_corrupt_cached_file_refetches(self):
        self.request["receipt"] = self.inspect()[0]["receipt"]
        Path(self.request["receipt"]["manifestPath"]).write_bytes(b"corrupt")
        self.fixture.calls.clear()
        self.inspect()
        self.assertIn("cdn-target", self.fixture.calls)

    def test_cdn_hash_mismatch_rejected(self):
        self.fixture.data = b"corrupt"
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            self.inspect()

    def test_actual_encrypted_manifest_and_prerequisites(self):
        self.fixture = Fixture(*manifest_bytes(encrypted=True))
        result, game, manifest = self.inspect()
        parsed = self.fixture.core.load_manifest(manifest[0])
        self.assertTrue(parsed.decrypt(manifest[3]))
        self.assertEqual(parsed.meta.launch_exe, "game.exe")
        self.assertEqual(parsed.meta.prereq_ids, ["prereq"])
        self.assertEqual(parsed.file_manifest_list.elements[0].filename, "game.exe")
        self.assertEqual(result["info"]["manifest"]["disk_size"], 456)

    def test_missing_decryption_key_rejected(self):
        self.fixture = Fixture(manifest_bytes(encrypted=True)[0])
        with self.assertRaisesRegex(managed.ManagedError, "manifest-decryption-failed"):
            self.inspect()

    def test_preload_and_cross_identity_rejected(self):
        self.fixture.element["isPreloaded"] = True
        with self.assertRaisesRegex(managed.ManagedError, "preload-unavailable"):
            self.inspect()
        self.fixture.element["isPreloaded"] = False
        self.fixture.element["appName"] = "Other"
        with self.assertRaisesRegex(managed.ManagedError, "invalid-manifest"):
            self.inspect()

    def test_external_and_addon_rejected(self):
        self.fixture.metadata["customAttributes"] = dict(ThirdPartyManagedApp=dict(value="Origin"))
        with self.assertRaisesRegex(managed.ManagedError, "external-launcher-required"):
            self.inspect()
        self.fixture.metadata.pop("customAttributes")
        self.fixture.metadata["categories"].append(dict(path="addons/launchable"))
        with self.assertRaisesRegex(managed.ManagedError, "unsupported-game"):
            self.inspect()

    def test_read_access_does_not_resume_verify_or_refresh(self):
        expiry = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
        core = SimpleNamespace(lgd=SimpleNamespace(userdata=dict(access_token="private-access", refresh_token="private-refresh", account_id="account", expires_at=expiry)), egs=SimpleNamespace(session=SimpleNamespace(headers={})), apply_lgd_config=lambda: None)
        managed.initialize_access(core)
        self.assertNotIn("refresh_token", core.egs.user)
        self.assertTrue(core.login())
        with self.assertRaisesRegex(managed.ManagedError, "non-target-operation"):
            core.egs.start_session()

    def test_cached_api_configuration_is_applied_without_network_or_library(self):
        calls = []
        expiry = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
        cached = dict(version="cached-launcher", data_keys=[])
        core = LegendaryCore.__new__(LegendaryCore)
        core.lgd = SimpleNamespace(userdata=dict(access_token="private-access", account_id="account", expires_at=expiry), get_cached_version=lambda: dict(data=dict(egl_config=cached)))
        core.egs = SimpleNamespace(session=SimpleNamespace(headers={}), update_egs_params=lambda value: calls.append(value))
        managed.initialize_access(core)
        self.assertEqual(calls, [cached])
        self.assertEqual(core._egl_version, "cached-launcher")

    def test_install_reuses_upstream_with_target_only_getters(self):
        import legendary.cli as cli
        _, game, manifest = self.inspect()
        self.request.update(operation="install", args=["-y", "install", "Example", "--base-path", str(self.workspace)])
        def invoke_cli():
            instance = cli.LegendaryCLI()
            self.assertIs(instance.core.get_game("Example", update_meta=True), game)
            with self.assertRaisesRegex(managed.ManagedError, "non-target-operation"):
                instance.core.get_game_list()
            with self.assertRaisesRegex(managed.ManagedError, "non-target-operation"):
                instance.core.egs.get_game_achievements("namespace")
            self.assertEqual(instance.core.get_cdn_manifest(game), manifest)
            self.assertIn("--skipdlcs", sys.argv)
        with patch.object(cli, "main", invoke_cli), patch.object(cli, "LegendaryCLI", cli.LegendaryCLI):
            managed.run_install(self.fixture.core, self.request, game, manifest)

    def test_selective_packs_report_sizes_beyond_required_files(self):
        from legendary.utils import selective_dl
        self.fixture = Fixture(tagged_manifest_bytes())
        self.fixture.core.lgdapi = SimpleNamespace(get_sdl_config=lambda name: copy.deepcopy(SDL))
        with patch.dict(selective_dl.games, {"Example": {}}):
            sdl = self.inspect()[0]["info"]["sdl"]
        self.assertEqual(sdl["required_tags"], ["chunk0"])
        self.assertEqual((sdl["download_size"], sdl["disk_size"]), (120, 1200))
        packs = {pack["id"]: pack for pack in sdl["packs"]}
        self.assertEqual(sorted(packs), ["de", "fr"])
        self.assertEqual((packs["de"]["download_size"], packs["de"]["disk_size"]), (70, 700))
        self.assertEqual((packs["fr"]["download_size"], packs["fr"]["disk_size"]), (90, 900))
        self.assertEqual(packs["fr"]["name"], "Français")
        self.assertEqual(packs["de"]["tags"], ["voice_de"])

    def test_selective_definition_falls_back_and_rejects_malformed_data(self):
        from legendary.utils import selective_dl
        def unavailable(name):
            raise ValueError("offline")
        core = SimpleNamespace(lgdapi=SimpleNamespace(get_sdl_config=unavailable))
        self.assertIsNone(managed.sdl_definition(core, "Example"))
        with patch.dict(selective_dl.games, {"Example": copy.deepcopy(SDL)}):
            self.assertEqual(managed.sdl_definition(core, "Example"), SDL)
            core.lgdapi.get_sdl_config = lambda name: {"de": dict(tags=["--manifest=x"], name="Bad")}
            self.assertEqual(managed.sdl_definition(core, "Example"), SDL)
        for value in (None, {}, {"__required": SDL["__required"]}, {"de": dict(tags=[], name="Empty")}, {"de": dict(tags=["voice"], name="")}, {"../x": dict(tags=["voice"], name="Path")}, {f"p{i}": dict(tags=["t"], name="n") for i in range(66)}):
            self.assertFalse(managed.valid_sdl(value))

    def test_dlc_target_must_belong_to_the_base_game(self):
        base = dict(TARGET)
        request = dict(target=DLC, base=base)
        self.assertEqual(managed.base_from_request(request), base)
        self.assertIsNone(managed.base_from_request(dict(target=DLC)))
        for invalid in (dict(TARGET, artifactId="ExampleDlc"), dict(TARGET, catalogItemId="dlc"), dict(TARGET, artifactId="../x"), dict(TARGET, platform="Mac")):
            with self.assertRaises(managed.ManagedError):
                managed.base_from_request(dict(target=DLC, base=invalid))
        managed.validate_metadata(copy.deepcopy(DLC_METADATA), DLC, base)
        for change in (dict(mainGameItem=dict(id="other", releaseInfo=[dict(appId="Example")])), dict(mainGameItem=dict(id="item", releaseInfo=[dict(appId="Other")])), dict(mainGameItem=dict(id="item", releaseInfo=[])), dict(categories=[dict(path="games")]), dict(categories=[dict(path="addons"), dict(path="addons/launchable")])):
            with self.assertRaisesRegex(managed.ManagedError, "unsupported-game"):
                managed.validate_metadata({**copy.deepcopy(DLC_METADATA), **change}, DLC, base)
        with self.assertRaisesRegex(managed.ManagedError, "unsupported-game"):
            managed.validate_metadata(copy.deepcopy(DLC_METADATA), DLC)
        external = copy.deepcopy(DLC_METADATA)
        external["customAttributes"] = dict(partnerLinkType=dict(value="ubisoft"))
        with self.assertRaisesRegex(managed.ManagedError, "external-launcher-required"):
            managed.validate_metadata(external, DLC, base)

    def test_dlc_install_resolves_only_its_installed_base_game(self):
        from legendary.models.game import Game, GameAsset
        base_game = Game(app_name="Example", app_title="Example", metadata=dict(namespace="namespace", id="item"))
        base_game.asset_infos = {"Windows": GameAsset(app_name="Example", namespace="namespace", catalog_item_id="item", build_version="1", label_name="Live")}
        installed = {"Example"}
        core = SimpleNamespace(lgd=SimpleNamespace(get_game_meta=lambda name: base_game if name == "Example" else None), is_installed=lambda name: name in installed)
        self.assertIs(managed.installed_base_game(core, dict(TARGET)), base_game)
        self.assertIsNone(managed.installed_base_game(core, None))
        with self.assertRaisesRegex(managed.ManagedError, "invalid-target"):
            managed.installed_base_game(core, dict(TARGET, catalogItemId="other"))
        installed.clear()
        with self.assertRaisesRegex(managed.ManagedError, "base-not-installed"):
            managed.installed_base_game(core, dict(TARGET))
        self.assertEqual(managed.error_code(managed.ManagedError("base-not-installed")), "installation-missing")
        dlc = Game(app_name="ExampleDlc", app_title="DLC", metadata=copy.deepcopy(DLC_METADATA))
        constrained = SimpleNamespace(egs=SimpleNamespace())
        managed.constrain_core(constrained, dlc, DLC, ("manifest",), base_game)
        self.assertIs(constrained.get_game("ExampleDlc"), dlc)
        self.assertIs(constrained.get_game("Example"), base_game)
        with self.assertRaisesRegex(managed.ManagedError, "invalid-target"):
            constrained.get_game("Unrelated")

    def test_install_tags_are_the_only_selection_arguments_accepted(self):
        import legendary.cli as cli
        _, game, manifest = self.inspect()
        captured = []
        for tags, accepted in ((["--install-tag=", "--install-tag=voice_de"], True), (["--install-tag", "voice_de"], False), (["--install-tag=../x"], False), (["--reset-sdl"], False)):
            self.request.update(operation="install", args=["-y", "install", "Example", *tags])
            if not accepted:
                with self.assertRaisesRegex(managed.ManagedError, "invalid-request"):
                    managed.run_install(self.fixture.core, self.request, game, manifest)
                continue
            with patch.object(cli, "main", side_effect=lambda: captured.append(list(sys.argv))), patch.object(cli, "LegendaryCLI", cli.LegendaryCLI):
                managed.run_install(self.fixture.core, self.request, game, manifest)
        self.assertIn("--install-tag=voice_de", captured[0])
        self.assertIn("--disable-sdl", captured[0])

    def test_receipt_outside_private_workspace_is_rejected(self):
        with self.assertRaisesRegex(managed.ManagedError, "invalid-receipt"):
            managed.receipt_path(self.workspace.parent / "outside.manifest", self.workspace)

    def test_expired_access_is_rejected_without_refresh(self):
        user = dict(access_token="private-access", account_id="account", expires_at="2000-01-01T00:00:00Z")
        with self.assertRaisesRegex(managed.ManagedError, "authentication-expired"):
            managed.initialize_access(SimpleNamespace(lgd=SimpleNamespace(userdata=user)))

    def test_errors_use_fixed_domain_codes_without_private_details(self):
        self.assertEqual(managed.error_code(managed.ManagedError("authentication-required")), "session-expired")
        self.assertEqual(managed.error_code(managed.ManagedError("preload-unavailable")), "not-installable")
        self.assertEqual(managed.error_code(ValueError("private-token:https://example?secret")), "invalid-response")


unittest.main()
