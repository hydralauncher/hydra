import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Game, UserLocationCoverage } from "@types";

import { safeRelativeSegments } from "./emulator-provider-identity.js";

export const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

export const serialsForGame = (game: Game) =>
  new Set(
    (game.discs ?? [])
      .map((disc) => disc.sku?.toUpperCase().replace(/[^A-Z0-9]/g, ""))
      .filter((sku): sku is string =>
        Boolean(sku && /^[A-Z]{4}\d{5}$/.test(sku))
      )
      .map((sku) => `${sku.slice(0, 4)}-${sku.slice(4)}`)
  );

export const parseIni = (content: string) => {
  const values = new Map<string, string>();
  let section = "";
  for (const line of content.split(/\r?\n/)) {
    const heading = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (heading) {
      section = heading[1].trim().toLowerCase();
      continue;
    }
    const item = /^\s*([^=;#]+?)\s*=\s*(.*?)\s*$/.exec(line);
    if (item) {
      const raw = item[2].trim();
      values.set(
        `${section}.${item[1].trim().toLowerCase()}`,
        raw.replace(/^(['"])(.*)\1$/, "$2")
      );
    }
  }
  return (group: string, key: string) =>
    values.get(`${group.toLowerCase()}.${key.toLowerCase()}`) ?? null;
};

export const readFirstConfig = async (candidates: string[]) => {
  for (const candidate of [...new Set(candidates)]) {
    const stat = await fs.lstat(candidate).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) continue;
    return {
      path: candidate,
      get: parseIni(await fs.readFile(candidate, "utf8")),
    };
  }
  return null;
};

export const resolveConfiguredPath = (
  root: string,
  value: string | null,
  fallback: string
) => {
  const chosen = value?.trim() || fallback;
  return path.resolve(
    path.isAbsolute(chosen) ? chosen : path.join(root, chosen)
  );
};

export const isRegularFile = async (file: string) => {
  const stat = await fs.lstat(file).catch(() => null);
  return Boolean(stat?.isFile() && !stat.isSymbolicLink());
};

export const isSafeFilePath = async (root: string, relative: string) => {
  const segments = safeRelativeSegments(relative);
  if (!segments) return false;
  let current = root;
  const rootStat = await fs.lstat(root).catch(() => null);
  if (rootStat && (!rootStat.isDirectory() || rootStat.isSymbolicLink()))
    return false;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch(() => null);
    if (stat?.isSymbolicLink()) return false;
  }
  return true;
};

export const exportedSavePath = async (
  game: Game,
  emulator: string,
  slot: string,
  name: string,
  privateRoot?: string
) => {
  const root =
    privateRoot ??
    (await import("../system-path.js")).SystemPath.getPath("userData");
  return path.join(
    root,
    "cloud-save-v2-emulator-exports",
    sha256(JSON.stringify([game.shop, game.objectId])),
    emulator,
    slot,
    name
  );
};

export const isSafePrivateExportPath = async (destination: string) => {
  const exportRoot = path.dirname(
    path.dirname(path.dirname(path.dirname(destination)))
  );
  if (path.basename(exportRoot) !== "cloud-save-v2-emulator-exports") {
    return false;
  }
  let current = destination;
  for (;;) {
    const stat = await fs.lstat(current).catch(() => null);
    if (
      stat &&
      (stat.isSymbolicLink() ||
        (current === destination ? !stat.isFile() : !stat.isDirectory()))
    ) {
      return false;
    }
    if (current === exportRoot) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
};

export const writeExport = async (destination: string, data: Buffer) => {
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  if (!(await isSafePrivateExportPath(destination))) {
    throw new Error("cloud_save_export_path_unsafe");
  }
  const existing = await fs.readFile(destination).catch(() => null);
  if (existing?.equals(data)) return;
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, data, { mode: 0o600 });
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
};

export const makeCoverage = (
  rawPath: string,
  variantId: string,
  complete: boolean
): UserLocationCoverage => ({
  candidateId: sha256(rawPath),
  ruleId: sha256(JSON.stringify(["emulator", rawPath])),
  variantId,
  rawPath,
  selectedRoot: true,
  authority: "exact",
  outcome: complete ? "scanned" : "partial",
  enumeratedCompletely: complete,
  warningCodes: complete ? [] : ["emulator-location-partial"],
});

export const unresolvedCoverage = (
  emulator: string,
  reason: string
): UserLocationCoverage => {
  const rawPath = `<emulator>/${emulator}/unresolved`;
  return {
    candidateId: sha256(`${rawPath}:${reason}`),
    ruleId: sha256(JSON.stringify(["emulator", rawPath])),
    rawPath,
    selectedRoot: false,
    authority: "inferred",
    outcome: "unresolved",
    enumeratedCompletely: false,
    warningCodes: [reason],
  };
};

export const hostPlatform = () =>
  process.platform === "darwin"
    ? "mac"
    : process.platform === "win32"
      ? "windows"
      : "linux";

export const homeDirectory = () => os.homedir();
