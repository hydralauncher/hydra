import fs from "node:fs";

function isExistingDirectory(directory: string): boolean {
  try {
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Creates `directory` (recursively) if it does not exist yet.
 *
 * On Windows, `mkdir` on a drive root such as "D:\" fails with EPERM even
 * with `{ recursive: true }` and even for regular users with full write
 * access, so a failed mkdir is only treated as an error when the directory
 * really does not exist afterwards.
 */
export function ensureDirectorySync(directory: string): void {
  if (isExistingDirectory(directory)) return;

  try {
    fs.mkdirSync(directory, { recursive: true });
  } catch (error) {
    if (isExistingDirectory(directory)) return;
    throw error;
  }
}
