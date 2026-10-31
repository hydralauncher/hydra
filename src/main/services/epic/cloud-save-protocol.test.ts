import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  assertEpicSaveCommandSucceeded,
  decideEpicSaveSync,
  isEpicRemoteSaveTimestamp,
  isEpicSaveFile,
  matchesEpicSaveFilter,
  parseEpicRemoteManifest,
  parseEpicSaveMetadata,
  resolveEpicSavePath,
} from "./cloud-save-protocol.js";

const accountId = "a".repeat(32);
const manifestPath = (
  name: string,
  artifact = "Artifact",
  account = accountId
) => `savesync/${account}/${artifact}/manifests/${name}`;

test("remote upload dates must be valid UTC timestamps, retaining microseconds", () => {
  for (const timestamp of [
    "2026-10-14T10:00:00Z",
    "2026-10-14T10:00:00.000Z",
    "2026-10-14T10:00:00.123456Z",
  ])
    assert.equal(isEpicRemoteSaveTimestamp(timestamp), true);
  for (const timestamp of [
    null,
    "invalid",
    "2026-02-31T10:00:00.000Z",
    "2026-10-14T25:00:00.000Z",
  ])
    assert.equal(isEpicRemoteSaveTimestamp(timestamp), false);
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

test("selects the most recent upload even when its save filename is older", () => {
  const older = "2026.10.13-12.00.00.manifest";
  const newer = "2026.10.14-12.00.00.manifest";
  assert.deepEqual(
    parseEpicRemoteManifest(
      {
        files: {
          [manifestPath(older)]: { lastModified: "2026-10-15T12:00:00.000Z" },
          [manifestPath(newer)]: { lastModified: "2026-10-14T12:00:00.000Z" },
        },
      },
      "Artifact",
      accountId
    ),
    { name: older, lastModified: "2026-10-15T12:00:00.000Z" }
  );
});

test("matches Legendary ordering for equal dates and sub-millisecond uploads", () => {
  const names = [
    "2026.10.13-12.00.00.manifest",
    "2026.10.14-12.00.00.manifest",
  ];
  for (const dates of [
    ["2026-10-15T12:00:00.123457Z", "2026-10-15T12:00:00.123456Z"],
    ["2026-10-15T12:00:00.1Z", "2026-10-15T12:00:00.099999Z"],
  ])
    assert.equal(
      parseEpicRemoteManifest(
        {
          files: Object.fromEntries(
            names.map((name, index) => [
              manifestPath(name),
              { lastModified: dates[index] },
            ])
          ),
        },
        "Artifact",
        accountId
      )?.name,
      names[0]
    );
  assert.equal(
    parseEpicRemoteManifest(
      {
        files: Object.fromEntries(
          names.map((name) => [
            manifestPath(name),
            { lastModified: "2026-10-15T12:00:00Z" },
          ])
        ),
      },
      "Artifact",
      accountId
    )?.name,
    names[1]
  );
});

test("rejects malformed, foreign or undated listings rather than assuming no save exists", () => {
  const name = "2026.10.14-12.00.00.manifest";
  assert.equal(
    parseEpicRemoteManifest({ files: {} }, "Artifact", accountId),
    null
  );
  for (const input of [
    null,
    "Save games:\n",
    {},
    { files: [] },
    {
      files: {
        [manifestPath(name, "Other")]: { lastModified: "2026-10-14T12:00:00Z" },
      },
    },
    {
      files: {
        [manifestPath(name, "Artifact", "other")]: {
          lastModified: "2026-10-14T12:00:00Z",
        },
      },
    },
    {
      files: {
        [manifestPath("broken")]: { lastModified: "2026-10-14T12:00:00Z" },
      },
    },
    { files: { [manifestPath(name)]: {} } },
    { files: { [manifestPath(name)]: { lastModified: "invalid" } } },
  ])
    assert.throws(() => parseEpicRemoteManifest(input, "Artifact", accountId));
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
  const remote = { name: "manifest", lastModified: "2026-10-14T12:00:00Z" };
  const changed = { ...remote, name: "changed" };
  const anchor = {
    localDigest: "local",
    remoteManifest: remote.name,
    remoteModifiedAt: remote.lastModified,
  };
  assert.equal(
    decideEpicSaveSync(undefined, "local", 1, remote, false),
    "conflict"
  );
  assert.equal(
    decideEpicSaveSync(undefined, "empty", 0, remote, false),
    "download"
  );
  assert.equal(
    decideEpicSaveSync(undefined, "local", 1, null, false),
    "upload"
  );
  assert.equal(decideEpicSaveSync(anchor, "local", 1, remote, true), "same");
  assert.equal(
    decideEpicSaveSync(anchor, "changed", 1, remote, false),
    "upload"
  );
  assert.equal(
    decideEpicSaveSync(anchor, "local", 1, changed, false),
    "download"
  );
  assert.equal(
    decideEpicSaveSync(anchor, "changed", 1, changed, false),
    "conflict"
  );
  assert.equal(
    decideEpicSaveSync(anchor, "local", 1, changed, true),
    "conflict"
  );
});

test("detects same-name reuploads and safely replaces anchors without upload metadata", () => {
  const remote = {
    name: "2026.10.14-12.00.00.manifest",
    lastModified: "2026-10-15T12:00:00Z",
  };
  for (const remoteModifiedAt of [undefined, "2026-10-14T12:00:00Z"]) {
    const anchor = {
      localDigest: "local",
      remoteManifest: remote.name,
      remoteModifiedAt,
    };
    assert.equal(
      decideEpicSaveSync(anchor, "local", 1, remote, false),
      "download"
    );
    assert.equal(
      decideEpicSaveSync(anchor, "edited", 1, remote, false),
      "conflict"
    );
    assert.equal(
      decideEpicSaveSync(anchor, "local", 1, remote, true),
      "conflict"
    );
  }
});
