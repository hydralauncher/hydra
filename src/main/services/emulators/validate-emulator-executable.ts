import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  openSync,
  readSync,
  statSync,
} from "node:fs";
import path from "node:path";
import {
  findMacAppBundleRoot,
  resolveMacAppBundleExecutable,
} from "./macos-app-bundle.js";
import { isExecutableNameExpectedForBinary } from "./is-executable-name-expected.js";

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

const DOS_HEADER_SIZE = 64;
const PE_HEADER_OFFSET_POSITION = 0x3c;
const DOS_SIGNATURE = "MZ";
const PE_SIGNATURE = Buffer.from([0x50, 0x45, 0, 0]);

const hasPortableExecutableHeader = (executablePath: string): boolean => {
  let fileDescriptor: number | null = null;

  try {
    fileDescriptor = openSync(executablePath, "r");
    const dosHeader = Buffer.alloc(DOS_HEADER_SIZE);
    if (
      readSync(fileDescriptor, dosHeader, 0, dosHeader.length, 0) !==
        dosHeader.length ||
      dosHeader.subarray(0, DOS_SIGNATURE.length).toString("ascii") !==
        DOS_SIGNATURE
    ) {
      return false;
    }

    const peHeaderOffset = dosHeader.readUInt32LE(PE_HEADER_OFFSET_POSITION);
    const peSignature = Buffer.alloc(PE_SIGNATURE.length);
    return (
      readSync(
        fileDescriptor,
        peSignature,
        0,
        peSignature.length,
        peHeaderOffset
      ) === peSignature.length && peSignature.equals(PE_SIGNATURE)
    );
  } catch {
    return false;
  } finally {
    if (fileDescriptor !== null) closeSync(fileDescriptor);
  }
};

export const isValidEmulatorExecutable = (
  executablePath: string,
  platform: NodeJS.Platform = process.platform
): boolean => {
  if (!executablePath) return false;

  const normalizedPath = path.normalize(executablePath);

  if (!existsSync(normalizedPath)) return false;

  const ext = path.extname(normalizedPath).toLowerCase();
  const appBundlePath = findMacAppBundleRoot(normalizedPath);

  if (appBundlePath) {
    return (
      ext === ".app" && resolveMacAppBundleExecutable(appBundlePath) !== null
    );
  }

  try {
    const stat = statSync(normalizedPath);

    if (!stat.isFile()) return false;
  } catch {
    return false;
  }

  if (NON_EXECUTABLE_EXTENSIONS.has(ext)) return false;

  if (platform === "win32") {
    if (ext === ".exe") return hasPortableExecutableHeader(normalizedPath);
    return ext === ".bat" || ext === ".cmd";
  }

  try {
    accessSync(normalizedPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export const assertValidEmulatorExecutable = (executablePath: string): void => {
  if (!isValidEmulatorExecutable(executablePath)) {
    throw new Error(`Invalid emulator executable: ${executablePath}`);
  }
};

export const isValidEmulatorExecutableForBinary = (
  executablePath: string,
  binary: { binary: string }
): boolean =>
  isValidEmulatorExecutable(executablePath) &&
  isExecutableNameExpectedForBinary(executablePath, binary);
