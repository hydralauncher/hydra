import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  CloudSaveV2FileDetails,
  CloudSaveV2LocalFile,
  CloudSaveV2RemoteFile,
} from "@types";

import type { RomSaveLocation } from "./retroarch-save-scanner.js";

// @ts-ignore The Node ESM test runner requires the source extension.
import { setRetroArchFileDisplayNames } from "./retroarch-file-display-names.ts";

const rawPath = "<emulator>/retroarch-v2/snes";
const location: RomSaveLocation = {
  rawPath,
  romPath: "/roms/Novo.sfc",
  saveDirectory: "/saves",
  stateDirectory: "/states",
  stem: "Novo",
  hasTransferPak: false,
};

const localFile = (
  relativePath: string,
  absolutePath: string,
  fileRawPath = rawPath
): CloudSaveV2LocalFile => ({
  source: "local",
  variantId: "default",
  rawPath: fileRawPath,
  relativePath,
  absolutePath,
  sizeBytes: 4,
  lastModifiedAt: null,
  userLabel: "Default",
});

const remoteFile = (
  relativePath: string,
  fileRawPath = rawPath
): CloudSaveV2RemoteFile => ({
  source: "remote",
  variantId: "default",
  rawPath: fileRawPath,
  relativePath,
  sizeBytes: 4,
  lastModifiedAt: null,
  userLabel: "Default",
});

const detailsFor = (
  local: CloudSaveV2LocalFile,
  remote: CloudSaveV2RemoteFile
): CloudSaveV2FileDetails => ({
  state: "synced",
  local: { kind: "local", fileCount: 1, totalSizeBytes: 4, files: [local] },
  activeSnapshot: {
    kind: "active-snapshot",
    snapshotId: "snapshot",
    version: 1,
    updatedAt: "2026-09-30T00:00:00.000Z",
    fileCount: 1,
    totalSizeBytes: 4,
    files: [remote],
  },
  customPaths: [],
  unresolvedCustomPaths: [],
  comparisons: [
    {
      variantId: local.variantId,
      rawPath: local.rawPath,
      relativePath: local.relativePath,
      status: "unchanged",
      local,
      remote,
    },
  ],
  variants: [],
  unresolvedRemoteVariantCount: 0,
});

describe("RetroArch cloud save display names", () => {
  it("shows physical local and current destination names without changing identities", () => {
    const details = detailsFor(
      localFile("battery.srm", "/saves/Antigo.srm"),
      remoteFile("battery.srm")
    );

    setRetroArchFileDisplayNames(details, location);

    assert.equal(details.local.files[0].displayName, "Antigo.srm");
    assert.equal(details.activeSnapshot?.files[0].displayName, "Novo.srm");
    assert.equal(details.comparisons[0].local?.displayName, "Antigo.srm");
    assert.equal(details.comparisons[0].remote?.displayName, "Novo.srm");
    assert.equal(details.comparisons[0].relativePath, "battery.srm");
    assert.equal(details.local.fileCount, 1);
    assert.equal(details.activeSnapshot?.fileCount, 1);
  });

  it("uses a valid state binding and falls back for a missing or stale binding", () => {
    const stateId = "a".repeat(64);
    const relativePath = `states/${stateId}.state`;
    const details = detailsFor(
      localFile(relativePath, "/states/Antigo.state1"),
      remoteFile(relativePath)
    );

    setRetroArchFileDisplayNames(details, location, [
      {
        id: stateId,
        path: "/states/Novo.state2",
        slot: ".state2",
        hash: "b".repeat(64),
      },
    ]);
    assert.equal(details.local.files[0].displayName, "Antigo.state1");
    assert.equal(details.activeSnapshot?.files[0].displayName, "Novo.state2");

    const missing = detailsFor(
      localFile(relativePath, "/states/Antigo.state1"),
      remoteFile(relativePath)
    );
    setRetroArchFileDisplayNames(missing, location);
    assert.equal(missing.activeSnapshot?.files[0].displayName, undefined);

    const unavailable = detailsFor(
      localFile(relativePath, "/states/Antigo.state1"),
      remoteFile(relativePath)
    );
    setRetroArchFileDisplayNames(unavailable, location, [
      {
        id: stateId,
        path: "/other/Novo.state2",
        slot: ".state2",
        hash: "b".repeat(64),
      },
    ]);
    assert.equal(unavailable.activeSnapshot?.files[0].displayName, undefined);
  });

  it("keeps the remote logical name when configuration is unavailable", () => {
    const details = detailsFor(
      localFile("battery.srm", "C:\\Saves\\Meu Jogo.srm"),
      remoteFile("battery.srm")
    );

    setRetroArchFileDisplayNames(details, null);

    assert.equal(details.local.files[0].displayName, "Meu Jogo.srm");
    assert.equal(details.activeSnapshot?.files[0].displayName, undefined);
  });

  it("preserves unrelated providers", () => {
    const details = detailsFor(
      localFile(
        "save.dat",
        "/saves/save.dat",
        "<emulator>/rpcs3/BLUS12345/00000001"
      ),
      remoteFile("save.dat", "<emulator>/rpcs3/BLUS12345/00000001")
    );

    setRetroArchFileDisplayNames(details, location);

    assert.equal(details.local.files[0].displayName, undefined);
    assert.equal(details.activeSnapshot?.files[0].displayName, undefined);
  });
});
