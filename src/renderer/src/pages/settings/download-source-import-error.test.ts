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

  it("does not describe a busy operation as an invalid file", () => {
    for (const error of [
      new Error("download_source_operation_in_progress"),
      ipcError("download_source_operation_in_progress"),
    ]) {
      assert.equal(
        getDownloadSourceImportErrorKey(error),
        "download_sources_import_in_progress"
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
