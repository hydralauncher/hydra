import { accessSync, constants, existsSync, statSync } from "node:fs";
import path from "node:path";

const NON_EXECUTABLE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".webp",
  ".svg",
  ".ico",
  ".mp3",
  ".wav",
  ".flac",
  ".ogg",
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".webm",
  ".txt",
  ".md",
  ".pdf",
  ".doc",
  ".docx",
  ".rtf",
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".gz",
  ".xz",
  ".iso",
  ".bin",
  ".cue",
  ".chd",
  ".pkg",
  ".cso",
  ".json",
  ".xml",
  ".ini",
  ".cfg",
  ".log",
  ".html",
  ".htm",
]);

export const isValidEmulatorExecutable = (executablePath: string): boolean => {
  if (!executablePath || !existsSync(executablePath)) return false;

  try {
    if (!statSync(executablePath).isFile()) return false;
  } catch {
    return false;
  }

  const ext = path.extname(executablePath).toLowerCase();
  if (NON_EXECUTABLE_EXTENSIONS.has(ext)) return false;

  if (process.platform === "win32") {
    return ext === ".exe" || ext === ".bat" || ext === ".cmd";
  }

  try {
    accessSync(executablePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};
