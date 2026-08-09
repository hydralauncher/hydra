import fs from "node:fs/promises";
import path from "node:path";

export type OnlineFixProvider = "onlinefix" | "freetp" | "photon" | "unknown";

export interface OnlineFixDetectionResult {
  hasFix: boolean;
  provider: OnlineFixProvider;
  overrides: string;
  detectedFiles: string[];
  managedEntries: string[];
  steamFixIniPaths: string[];
  missingDependencies: string[];
  warnings: string[];
}

const MAX_DEPTH = 3;

const KNOWN_ONLINEFIX_DLLS = new Map<string, string>([
  ["onlinefix64.dll", "OnlineFix64=n"],
  ["onlinefix.dll", "OnlineFix=n"],
  ["steamoverlay64.dll", "SteamOverlay64=n"],
  ["steamoverlay.dll", "SteamOverlay=n"],
  ["winmm.dll", "winmm=n,b"],
  ["version.dll", "version=n,b"],
  ["emp.dll", "emp=n"],
]);

const IGNORED_DIRS = new Set([
  ".git",
  "assets",
  "audio",
  "content",
  "data",
  "engine",
  "movies",
  "music",
  "node_modules",
  "sound",
]);

const MANIFEST_NAMES = new Set(["winmm.txt", "dlllist.txt"]);

type ScanState = {
  detectedFiles: Set<string>;
  managedEntries: Set<string>;
  overrides: Map<string, string>;
  steamFixIniPaths: Set<string>;
  photonDirs: Set<string>;
  eosCandidates: Map<string, string>;
  hasStrongSignature: boolean;
  hasOnlineFixSignature: boolean;
  hasFreeTpSignature: boolean;
  hasPhotonSignature: boolean;
  warnings: string[];
};

function canonicalDllKey(name: string): string {
  return path.parse(path.basename(name)).name.toLowerCase();
}

function addOverride(state: ScanState, dllName: string, value = "n") {
  const key = canonicalDllKey(dllName);
  if (!key) return;
  if (!state.overrides.has(key)) {
    state.overrides.set(
      key,
      `${path.parse(path.basename(dllName)).name}=${value}`
    );
  }
}

function normalizeManifestDll(line: string): string | null {
  const noComment = line.split(/[;#]/, 1)[0]?.trim() ?? "";
  if (!noComment) return null;

  const unquoted = noComment.replace(/^["']|["']$/g, "");
  if (unquoted.includes("/") || unquoted.includes("\\")) return null;

  const base = path.basename(unquoted);
  if (!base.toLowerCase().endsWith(".dll")) return null;
  return base;
}

async function parseManifest(manifestPath: string, state: ScanState) {
  try {
    const content = await fs.readFile(manifestPath, "utf-8");
    for (const rawLine of content.split(/\r?\n/)) {
      const trimmed = rawLine.split(/[;#]/, 1)[0]?.trim() ?? "";
      if (!trimmed) continue;

      const unquoted = trimmed.replace(/^[\"']|[\"']$/g, "");
      const lower = unquoted.toLowerCase();

      if (lower.endsWith(".net") || lower.endsWith(".net.org")) {
        state.managedEntries.add(unquoted);
        continue;
      }

      const dll = normalizeManifestDll(unquoted);
      if (!dll) continue;

      addOverride(state, dll, dll.toLowerCase() === "winmm.dll" ? "n,b" : "n");
    }
  } catch (error) {
    state.warnings.push(`Could not read ${manifestPath}`);
    console.error(`Error reading OnlineFix manifest ${manifestPath}:`, error);
  }
}

async function scanDirectory(
  currentPath: string,
  depth: number,
  state: ScanState
): Promise<void> {
  if (depth > MAX_DEPTH) return;

  let entries;
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch (error) {
    state.warnings.push(`Could not scan ${currentPath}`);
    console.error(`Error scanning OnlineFix directory ${currentPath}:`, error);
    return;
  }

  let hasLauncherExe = false;
  let hasLaunchMetadata = false;

  for (const entry of entries) {
    const fullPath = path.join(currentPath, entry.name);
    const lower = entry.name.toLowerCase();

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(lower)) {
        await scanDirectory(fullPath, depth + 1, state);
      }
      continue;
    }

    if (!entry.isFile()) continue;

    const knownOverride = KNOWN_ONLINEFIX_DLLS.get(lower);
    if (knownOverride) {
      state.detectedFiles.add(fullPath);
      state.hasStrongSignature = true;
      state.hasOnlineFixSignature = true;
      const [dllName, value] = knownOverride.split("=");
      addOverride(state, `${dllName}.dll`, value);
      continue;
    }

    if (MANIFEST_NAMES.has(lower)) {
      state.detectedFiles.add(fullPath);
      state.hasStrongSignature = true;
      await parseManifest(fullPath, state);
      continue;
    }

    if (lower === "steamfix.ini") {
      state.detectedFiles.add(fullPath);
      state.steamFixIniPaths.add(fullPath);
      state.hasStrongSignature = true;
      state.hasFreeTpSignature = true;
      continue;
    }

    if (lower === "launcher.exe") {
      hasLauncherExe = true;
      continue;
    }

    if (lower === "onlinefix.json" || lower.startsWith("launch_data.of")) {
      hasLaunchMetadata = true;
      continue;
    }

    if (
      lower.endsWith(".dll") &&
      (lower.startsWith("eos") || lower.startsWith("epicfix"))
    ) {
      state.eosCandidates.set(fullPath, entry.name);
    }
  }

  if (hasLauncherExe && hasLaunchMetadata) {
    state.hasStrongSignature = true;
    state.hasPhotonSignature = true;
    state.photonDirs.add(currentPath);
    state.detectedFiles.add(path.join(currentPath, "Launcher.exe"));
  }
}

function chooseProvider(state: ScanState): OnlineFixProvider {
  if (state.hasPhotonSignature) return "photon";
  if (state.hasFreeTpSignature) return "freetp";
  if (state.hasOnlineFixSignature) return "onlinefix";
  return "unknown";
}

export async function detectOnlineFixCompatibility(
  gameFolder: string
): Promise<OnlineFixDetectionResult> {
  if (!gameFolder) {
    return {
      hasFix: false,
      provider: "unknown",
      overrides: "",
      detectedFiles: [],
      managedEntries: [],
      steamFixIniPaths: [],
      missingDependencies: [],
      warnings: ["Game folder was empty"],
    };
  }

  try {
    const stat = await fs.stat(gameFolder);
    if (!stat.isDirectory()) throw new Error("not a directory");
  } catch {
    return {
      hasFix: false,
      provider: "unknown",
      overrides: "",
      detectedFiles: [],
      managedEntries: [],
      steamFixIniPaths: [],
      missingDependencies: [],
      warnings: [`Game folder is unavailable: ${gameFolder}`],
    };
  }

  const state: ScanState = {
    detectedFiles: new Set(),
    managedEntries: new Set(),
    overrides: new Map(),
    steamFixIniPaths: new Set(),
    photonDirs: new Set(),
    eosCandidates: new Map(),
    hasStrongSignature: false,
    hasOnlineFixSignature: false,
    hasFreeTpSignature: false,
    hasPhotonSignature: false,
    warnings: [],
  };

  await scanDirectory(gameFolder, 0, state);

  if (state.hasStrongSignature) {
    for (const [fullPath, name] of state.eosCandidates) {
      state.detectedFiles.add(fullPath);
      addOverride(state, name);
    }
  }

  const missingDependencies: string[] = [];
  for (const photonDir of state.photonDirs) {
    const newtonsoft = path.join(photonDir, "Newtonsoft.Json.dll");
    try {
      await fs.access(newtonsoft);
    } catch {
      missingDependencies.push(newtonsoft);
    }
  }

  return {
    hasFix: state.hasStrongSignature,
    provider: chooseProvider(state),
    overrides: [...state.overrides.values()].join(";"),
    detectedFiles: [...state.detectedFiles].sort(),
    managedEntries: [...state.managedEntries].sort(),
    steamFixIniPaths: [...state.steamFixIniPaths].sort(),
    missingDependencies,
    warnings: state.warnings,
  };
}

export interface SteamFixPatchResult {
  path: string;
  changed: boolean;
  backupPath?: string;
  warnings: string[];
}

function replaceIniKey(
  content: string,
  key: string,
  value: string
): { content: string; changed: boolean } {
  const pattern = new RegExp(`(^\\s*${key}\\s*=\\s*)([^\\r\\n]+)`, "im");
  if (!pattern.test(content)) return { content, changed: false };
  const next = content.replace(pattern, `$1${value}`);
  return { content: next, changed: next !== content };
}

function readMainSectionValue(content: string, key: string): string | null {
  const section = content.match(
    /^\s*\[Main\]\s*$([\s\S]*?)(?=^\s*\[[^\]]+\]\s*$|\s*$)/im
  );
  if (!section) return null;

  const match = section[1].match(
    new RegExp(`^\\s*${key}\\s*=\\s*([^;#\\r\\n]+)`, "im")
  );
  return match?.[1]?.trim() ?? null;
}

export async function patchSteamFixIniSafely(
  iniPath: string
): Promise<SteamFixPatchResult> {
  const warnings: string[] = [];
  let original: string;

  try {
    original = await fs.readFile(iniPath, "utf-8");
  } catch (error) {
    console.error(`Could not read ${iniPath}:`, error);
    return { path: iniPath, changed: false, warnings: ["Could not read file"] };
  }

  let content = original;
  const realAppId = readMainSectionValue(content, "RealAppId");
  const fakeAppId = readMainSectionValue(content, "FakeAppId");

  if (
    realAppId &&
    fakeAppId &&
    !/^\s*\[OnlineFix Linux\]\s*$/im.test(content)
  ) {
    const replaced = replaceIniKey(content, "RealAppId", fakeAppId);
    content = replaced.content;
    if (replaced.changed) {
      content =
        `${content.trimEnd()}\n\n` +
        `[OnlineFix Linux]\nOriginalRealAppId=${realAppId}\n`;
    }
  } else if (!realAppId || !fakeAppId) {
    warnings.push(
      "steamfix.ini did not contain both [Main] RealAppId and FakeAppId"
    );
  }

  content = content.replace(
    /(^\s*ExtraProtection\s*=\s*)(true|1|yes)\s*$/gim,
    "$1false"
  );

  if (content === original) {
    return { path: iniPath, changed: false, warnings };
  }

  const backupPath = `${iniPath}.hydra-onlinefix.bak`;
  try {
    await fs.access(backupPath);
  } catch {
    await fs.copyFile(iniPath, backupPath);
  }

  await fs.writeFile(iniPath, content, "utf-8");
  console.info("Patched steamfix.ini for Linux compatibility", {
    iniPath,
    backupPath,
  });

  return { path: iniPath, changed: true, backupPath, warnings };
}
