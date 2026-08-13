import fs from "node:fs/promises";
import path from "node:path";

export type CompatibilityPatchProvider =
  | "primary"
  | "secondary"
  | "dependency"
  | "unknown";

export interface CompatibilityPatchDetectionResult {
  requiresCompatibilityMode: boolean;
  provider: CompatibilityPatchProvider;
  overrides: string;
  detectedFiles: string[];
  managedEntries: string[];
  configurationPaths: string[];
  missingDependencies: string[];
  warnings: string[];
}

const MAX_DEPTH = 3;

const KNOWN_COMPATIBILITY_DLLS = new Map<string, string>([
  ["onlinefix64.dll", "OnlineFix64=n"],
  ["onlinefix.dll", "OnlineFix=n"],
  ["steamoverlay64.dll", "SteamOverlay64=n"],
  ["steamoverlay.dll", "SteamOverlay=n"],
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
  configurationPaths: Set<string>;
  dependencyDirectories: Set<string>;
  eosCandidates: Map<string, string>;
  hasStrongSignature: boolean;
  hasPrimaryPatchSignature: boolean;
  hasSecondaryPatchSignature: boolean;
  hasDependencyPatchSignature: boolean;
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

      const unquoted = trimmed.replace(/^["']|["']$/g, "");
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
    state.warnings.push(
      `Could not read ${manifestPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function processCompatibilityFile(
  fullPath: string,
  lower: string,
  fileName: string,
  state: ScanState
): Promise<{ hasLauncherExe: boolean; hasLaunchMetadata: boolean }> {
  if (
    lower === "steam_api.dll" ||
    lower === "steam_api64.dll" ||
    lower === "steam_appid.txt" ||
    lower === "steam_emu.ini" ||
    lower === "sovereign.ini"
  ) {
    state.detectedFiles.add(fullPath);
  }

  const knownOverride = KNOWN_COMPATIBILITY_DLLS.get(lower);
  if (knownOverride) {
    state.detectedFiles.add(fullPath);
    state.hasStrongSignature = true;
    state.hasPrimaryPatchSignature = true;
    const [dllName, value] = knownOverride.split("=");
    addOverride(state, `${dllName}.dll`, value);
    return { hasLauncherExe: false, hasLaunchMetadata: false };
  }

  if (MANIFEST_NAMES.has(lower)) {
    state.detectedFiles.add(fullPath);
    state.hasStrongSignature = true;
    await parseManifest(fullPath, state);
    return { hasLauncherExe: false, hasLaunchMetadata: false };
  }

  if (lower === "steamfix.ini") {
    state.detectedFiles.add(fullPath);
    state.configurationPaths.add(fullPath);
    state.hasStrongSignature = true;
    state.hasSecondaryPatchSignature = true;
    return { hasLauncherExe: false, hasLaunchMetadata: false };
  }

  if (
    lower.endsWith(".dll") &&
    (lower.startsWith("eos") || lower.startsWith("epicfix"))
  ) {
    state.eosCandidates.set(fullPath, fileName);
  }

  return {
    hasLauncherExe: lower === "launcher.exe",
    hasLaunchMetadata:
      lower === "onlinefix.json" || lower.startsWith("launch_data.of"),
  };
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
    state.warnings.push(
      `Could not scan ${currentPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
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

    const result = await processCompatibilityFile(
      fullPath,
      lower,
      entry.name,
      state
    );

    hasLauncherExe ||= result.hasLauncherExe;
    hasLaunchMetadata ||= result.hasLaunchMetadata;
  }

  if (hasLauncherExe && hasLaunchMetadata) {
    state.hasStrongSignature = true;
    state.hasDependencyPatchSignature = true;
    state.dependencyDirectories.add(currentPath);
    state.detectedFiles.add(path.join(currentPath, "Launcher.exe"));
  }
}

function chooseProvider(state: ScanState): CompatibilityPatchProvider {
  if (state.hasDependencyPatchSignature) return "dependency";
  if (state.hasSecondaryPatchSignature) return "secondary";
  if (state.hasPrimaryPatchSignature) return "primary";
  return "unknown";
}

const STEAM_EMULATOR_CONFIG_NAMES = new Set(["steam_emu.ini", "sovereign.ini"]);

const hasSteamEmulatorConfiguration = (
  fileNames: Iterable<string>
): boolean => {
  const names = new Set(
    Array.from(fileNames, (fileName) => path.basename(fileName).toLowerCase())
  );

  const hasEmulatorConfig = [...STEAM_EMULATOR_CONFIG_NAMES].some((name) =>
    names.has(name)
  );

  if (!hasEmulatorConfig) return false;

  // steam_api*.dll is common in ordinary Steam games, so it is not
  // sufficient by itself. Require an emulator configuration plus
  // Steam API/app-id evidence.
  return (
    names.has("steam_api.dll") ||
    names.has("steam_api64.dll") ||
    names.has("steam_appid.txt")
  );
};

export async function detectCompatibilityPatch(
  gameFolder: string
): Promise<CompatibilityPatchDetectionResult> {
  if (!gameFolder) {
    return {
      requiresCompatibilityMode: false,
      provider: "unknown",
      overrides: "",
      detectedFiles: [],
      managedEntries: [],
      configurationPaths: [],
      missingDependencies: [],
      warnings: ["Game folder was empty"],
    };
  }

  try {
    const stat = await fs.stat(gameFolder);
    if (!stat.isDirectory()) throw new Error("not a directory");
  } catch {
    return {
      requiresCompatibilityMode: false,
      provider: "unknown",
      overrides: "",
      detectedFiles: [],
      managedEntries: [],
      configurationPaths: [],
      missingDependencies: [],
      warnings: [`Game folder is unavailable: ${gameFolder}`],
    };
  }

  const state: ScanState = {
    detectedFiles: new Set(),
    managedEntries: new Set(),
    overrides: new Map(),
    configurationPaths: new Set(),
    dependencyDirectories: new Set(),
    eosCandidates: new Map(),
    hasStrongSignature: false,
    hasPrimaryPatchSignature: false,
    hasSecondaryPatchSignature: false,
    hasDependencyPatchSignature: false,
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
  for (const dependencyDirectory of state.dependencyDirectories) {
    const newtonsoft = path.join(dependencyDirectory, "Newtonsoft.Json.dll");
    try {
      await fs.access(newtonsoft);
    } catch {
      missingDependencies.push(newtonsoft);
    }
  }
  /*
   * Some Steam-emulator configurations still require
   * a genuine Steam-owned Proton launch for Steam IPC to function correctly.
   *
   * Keep this deliberately conservative: steam_api*.dll alone is common in
   * legitimate Steam games and must not be treated as proof.
   */
  const steamEmulatorDetected = hasSteamEmulatorConfiguration(
    state.detectedFiles
  );

  if (steamEmulatorDetected) {
    state.warnings.push(
      "Detected Steam-emulator configuration; Steam-owned launch may be required"
    );
  }

  return {
    requiresCompatibilityMode:
      state.hasStrongSignature || steamEmulatorDetected,
    provider: chooseProvider(state),
    overrides: [...state.overrides.values()].join(";"),
    detectedFiles: [...state.detectedFiles].sort((a, b) => a.localeCompare(b)),
    managedEntries: [...state.managedEntries].sort((a, b) =>
      a.localeCompare(b)
    ),
    configurationPaths: [...state.configurationPaths].sort((a, b) =>
      a.localeCompare(b)
    ),
    missingDependencies,
    warnings: state.warnings,
  };
}
