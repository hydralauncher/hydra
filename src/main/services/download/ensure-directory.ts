import fs from "node:fs";

function isExistingDirectory(directory: string): boolean {
  try {
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

export function ensureDirectorySync(directory: string): void {
  if (isExistingDirectory(directory)) return;

  try {
    fs.mkdirSync(directory, { recursive: true });
  } catch (error) {
    if (isExistingDirectory(directory)) return;
    throw error;
  }
}
