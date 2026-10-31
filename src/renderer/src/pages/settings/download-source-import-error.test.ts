import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDownloadSourceImportErrorKey } from "./download-source-import-error.js";

const ipcError = (reason: string) =>
  new Error(
    `Error invoking remote method 'importDownloadSources': Error: ${reason}`
  );

describe("download source import error feedback", () => {
  it("identifies invalid backups with and without the Electron IPC prefix", () => {
    for (const reason of [
      "Invalid download source backup",
      "Invalid download source backup entry",
      "Download source backup is too large",
    ]) {
      assert.equal(
        getDownloadSourceImportErrorKey(new Error(reason)),
        "download_sources_import_invalid_file"
      );
      assert.equal(
        getDownloadSourceImportErrorKey(ipcError(reason)),
        "download_sources_import_invalid_file"
      );
    }
  });

  it("uses a generic failure for window, disk and unexpected errors", () => {
    for (const error of [
      ipcError("Source window is not available"),
      ipcError("EACCES: permission denied, open 'backup.json'"),
      new Error("Unexpected failure"),
      null,
      undefined,
      {},
    ]) {
      assert.equal(
        getDownloadSourceImportErrorKey(error),
        "download_sources_import_failed"
      );
    }
  });
});
