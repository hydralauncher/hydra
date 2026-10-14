import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  assertEpicSaveCommandSucceeded,
  decideEpicSaveSync,
  getEpicRemoteManifestModifiedAt,
  isEpicSaveFile,
  matchesEpicSaveFilter,
  parseEpicRemoteManifest,
  parseEpicSaveMetadata,
  resolveEpicSavePath,
} from "./cloud-save-protocol.js";

test("remote save manifest dates are UTC and invalid dates remain unknown", () => {
  assert.equal(
    getEpicRemoteManifestModifiedAt("2026.10.14-10.00.00.manifest"),
    "2026-10-14T10:00:00.000Z"
  );
  for (const manifest of [
    null,
    "invalid",
    "2026.02.31-10.00.00.manifest",
    "2026.10.14-25.00.00.manifest",
  ])
    assert.equal(getEpicRemoteManifestModifiedAt(manifest), null);
});

test("reads actual Epic save metadata and Legendary inclusion/exclusion semantics", () => {
  const metadata = parseEpicSaveMetadata(
    {
      metadata: {
        customAttributes: {
          CloudSaveFolder: { value: "{appdata}/Example/Saves" },
          CloudSaveFolder_MAC: { value: "{userlibrary}/Example/Saves" },
          CloudIncludeList: { value: "*.sav,profiles/" },
          CloudExcludeList: { value: "backup/,*.tmp" },
        },
      },
    },
    "Windows"
  );
  assert.equal(metadata.folder, "{appdata}/Example/Saves");
  assert.equal(isEpicSaveFile("a/b/profile.sav", metadata), true);
  assert.equal(isEpicSaveFile("profiles/config.ini", metadata), true);
  assert.equal(isEpicSaveFile("backup/profile.sav", metadata), false);
  assert.equal(isEpicSaveFile("profiles/profile.tmp", metadata), false);
  assert.equal(isEpicSaveFile("config.ini", metadata), false);
  assert.equal(matchesEpicSaveFilter("profile.SAV", ".sav", true), true);
  assert.equal(
    matchesEpicSaveFilter("a/slot2.sav", "a/slot[0-9].sav", false),
    true
  );
  assert.equal(
    parseEpicSaveMetadata(
      { customAttributes: { CloudSaveFolder_MAC: { value: "Mac" } } },
      "Windows"
    ).folder,
    null
  );
});

test("resolves save folders only from known variables and absolute paths", () => {
  assert.equal(
    resolveEpicSavePath(
      "{appdata}/Example/{epicid}",
      { "{appdata}": "C:/Users/Test/AppData/Local", "{epicid}": "account" },
      path.win32
    ),
    "C:\\Users\\Test\\AppData\\Local\\Example\\account"
  );
  assert.equal(resolveEpicSavePath("{unknown}/Example", {}, path.win32), null);
  assert.equal(
    resolveEpicSavePath("{appdata}/Example", { "{appdata}": "" }, path.win32),
    null
  );
  assert.equal(resolveEpicSavePath("%APPDATA%/Example", {}, path.win32), null);
  assert.equal(resolveEpicSavePath("../Example", {}, path.win32), null);
  assert.equal(resolveEpicSavePath("C:/", {}, path.win32), null);
});

test("reads latest exact-artifact manifest and rejects malformed/foreign responses", () => {
  assert.equal(
    parseEpicRemoteManifest(
      'Save games:\n- Example ("Artifact")\n + 2026.10.14-10.00.00.manifest\n + 2026.10.14-11.00.00.manifest\n',
      "Artifact"
    ),
    "2026.10.14-11.00.00.manifest"
  );
  assert.equal(parseEpicRemoteManifest("Save games:\n", "Artifact"), null);
  assert.throws(() => parseEpicRemoteManifest("", "Artifact"));
  assert.throws(() =>
    parseEpicRemoteManifest("Save games:\nUnknown response", "Artifact")
  );
  assert.throws(() =>
    parseEpicRemoteManifest("Save games:\nSave games:\n", "Artifact")
  );
  assert.throws(() =>
    parseEpicRemoteManifest('Save games:\n- Example ("Artifact")\n', "Artifact")
  );
  assert.throws(() =>
    parseEpicRemoteManifest(
      'Save games:\n- Example ("Other")\n + 2026.10.14-10.00.00.manifest',
      "Artifact"
    )
  );
  assert.throws(() =>
    parseEpicRemoteManifest(
      'Save games:\n- Example ("Artifact")\n + broken',
      "Artifact"
    )
  );
});

test("does not treat exit zero, skips or incomplete chunks as successful transfers", () => {
  assert.throws(() =>
    assertEpicSaveCommandSucceeded({ stdout: "", stderr: "" }, "upload")
  );
  assert.throws(() =>
    assertEpicSaveCommandSucceeded(
      { stdout: "", stderr: "[Core] INFO: No files to upload." },
      "upload"
    )
  );
  assert.throws(() =>
    assertEpicSaveCommandSucceeded(
      {
        stdout: "",
        stderr:
          "[Core] ERROR: Download failed\nSuccessfully completed savegame download.",
      },
      "download"
    )
  );
  assert.throws(() =>
    assertEpicSaveCommandSucceeded(
      {
        stdout: "",
        stderr:
          "Chunk part is missing, file may be corrupted!\nSuccessfully completed savegame download.",
      },
      "download"
    )
  );
  assert.doesNotThrow(() =>
    assertEpicSaveCommandSucceeded(
      { stdout: "", stderr: "[Core] INFO: Finished uploading savegame." },
      "upload"
    )
  );
});

test("anchors detect local/remote changes without trusting dates and preserve pending local saves", () => {
  const anchor = { localDigest: "local", remoteManifest: "manifest" };
  assert.equal(
    decideEpicSaveSync(undefined, "local", 1, "manifest", false),
    "conflict"
  );
  assert.equal(
    decideEpicSaveSync(undefined, "empty", 0, "manifest", false),
    "download"
  );
  assert.equal(
    decideEpicSaveSync(undefined, "local", 1, null, false),
    "upload"
  );
  assert.equal(
    decideEpicSaveSync(anchor, "local", 1, "manifest", true),
    "same"
  );
  assert.equal(
    decideEpicSaveSync(anchor, "changed", 1, "manifest", false),
    "upload"
  );
  assert.equal(
    decideEpicSaveSync(anchor, "local", 1, "changed", false),
    "download"
  );
  assert.equal(
    decideEpicSaveSync(anchor, "changed", 1, "changed", false),
    "conflict"
  );
  assert.equal(
    decideEpicSaveSync(anchor, "local", 1, "changed", true),
    "conflict"
  );
});
