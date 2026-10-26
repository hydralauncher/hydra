const INVALID_BACKUP_ERRORS = new Set([
  "Invalid download source backup",
  "Invalid download source backup entry",
  "Download source backup is too large",
]);

export const getDownloadSourceImportErrorKey = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  // Electron prefixes errors raised by an IPC handler with the invocation name.
  const reason = message.split(/:\s+/).at(-1)?.trim();

  if (reason === "download_source_operation_in_progress") {
    return "download_sources_import_in_progress";
  }
  if (reason && INVALID_BACKUP_ERRORS.has(reason)) {
    return "download_sources_import_invalid_file";
  }
  return "download_sources_import_failed";
};
