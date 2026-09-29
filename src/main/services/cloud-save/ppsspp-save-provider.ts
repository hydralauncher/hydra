import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { CloudSaveRule, Game } from "@types";

import { parseParamSfoValue } from "../emulators/param-sfo.js";
import { ppssppConfigCandidates } from "../emulators/ppsspp-paths.js";
import {
  emulatorSaveFileKey,
  emulatorRestoreRule,
  safeRelativeSegments,
} from "./emulator-provider-identity.js";
import {
  emulatorCoverage,
  emulatorPathHash,
  emulatorRuleId,
  emulatorUnresolvedCoverage,
  listSafeFiles,
  lstatIfExists,
  readDirectoryIfExists,
  safeRestorePath,
} from "./emulator-provider-fs.js";
import type {
  EmulatorProvider,
  EmulatorProviderContext,
  EmulatorProviderDiscovery,
} from "./emulator-provider-types.js";

const DISC_ID = /^[A-Z]{4}\d{5}$/;
const SAVEDATA_RAW_PATH = /^<emulator>\/ppsspp\/savedata\/([A-Z]{4}\d{5})$/;
const STATE_RAW_PATH = /^<emulator>\/ppsspp\/state\/([A-Z]{4}\d{5})$/;
const STATE_FILE =
  /^([A-Z]{4}\d{5})_([A-Za-z0-9.]+)_([0-9]+)\.(?:(undo)\.)?(ppst|jpg|name\.txt)$/;

export const titleIdsForGame = (game: Game) =>
  [
    ...new Set(
      (game.discs ?? []).map((disc) =>
        disc.sku?.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
      )
    ),
  ].filter((value): value is string => !!value && DISC_ID.test(value));

const parseIniValue = (content: string, key: string) => {
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([^=;#]+?)\s*=\s*(.*?)\s*$/.exec(line);
    if (match?.[1].toLowerCase() !== key.toLowerCase()) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2").trim();
    return value || null;
  }
  return null;
};

export const ppssppPspRootFromConfig = (
  configPath: string,
  content: string,
  homeDir = os.homedir()
) => {
  const configured = parseIniValue(content, "MemStickDirectory");
  if (!configured) return path.dirname(path.dirname(configPath));
  const expanded =
    configured === "~"
      ? homeDir
      : configured.startsWith("~/")
        ? path.join(homeDir, configured.slice(2))
        : configured;
  const memstick = path.isAbsolute(expanded)
    ? expanded
    : path.resolve(path.dirname(configPath), expanded);
  return path.join(memstick, "PSP");
};

export const resolvePpssppSaveLocation = async () => {
  const { getEmulatorConfig } = await import(
    "../emulators/emulators-repository.js"
  );
  const emulator = await getEmulatorConfig("psp");
  if (!emulator.executablePath)
    throw new Error("cloud_save_ppsspp_not_configured");
  for (const candidate of ppssppConfigCandidates(emulator.executablePath)) {
    const stat = await lstatIfExists(candidate).catch(() => null);
    if (!stat?.isFile()) continue;
    const configPath = await fs.realpath(candidate);
    const content = await fs.readFile(configPath, "utf8");
    const pspRoot = ppssppPspRootFromConfig(configPath, content);
    return { configPath, pspRoot };
  }
  throw new Error("cloud_save_ppsspp_config_unresolved");
};

export const getPpssppSaveEnvironmentKey = async (_game: Game) => {
  const location = await resolvePpssppSaveLocation().catch(() => null);
  return location
    ? JSON.stringify(["ppsspp-v1", location])
    : "ppsspp-save-root-unresolved";
};

const savedataIdentity = async (slotRoot: string) => {
  const sfoPath = path.join(slotRoot, "PARAM.SFO");
  const stat = await lstatIfExists(sfoPath).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink()) return null;
  const sfo = await fs.readFile(sfoPath).catch(() => null);
  if (!sfo) return null;
  for (const key of ["DISC_ID", "SAVEDATA_DIRECTORY"]) {
    const value = parseParamSfoValue(sfo, key);
    const normalized = value
      ?.replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .slice(0, 9);
    if (normalized && DISC_ID.test(normalized)) return normalized;
  }
  return null;
};

const stateParts = (fileName: string) => {
  const match = STATE_FILE.exec(fileName);
  if (!match) return null;
  return {
    titleId: match[1],
    prefix: `${match[1]}_${match[2]}_${match[3]}`,
    undo: Boolean(match[4]),
    extension: match[5],
  };
};

export const isPpssppGameSaveFile = (game: Game, filePath: string) => {
  const titleIds = titleIdsForGame(game);
  const segments = path.resolve(filePath).split(path.sep);
  const name = segments.at(-1) ?? "";
  const state = stateParts(name);
  if (
    state &&
    segments.some((segment) => segment.toUpperCase() === "PPSSPP_STATE") &&
    titleIds.includes(state.titleId)
  )
    return true;
  const index = segments.findLastIndex(
    (segment) => segment.toUpperCase() === "SAVEDATA"
  );
  return (
    index >= 0 &&
    index < segments.length - 2 &&
    titleIds.some((titleId) => segments[index + 1].startsWith(titleId))
  );
};

export const getPpssppGameSaveFileFilter =
  (game: Game) => async (filePath: string) => {
    if (!isPpssppGameSaveFile(game, filePath)) return false;
    const segments = path.resolve(filePath).split(path.sep);
    const savedataIndex = segments.findLastIndex(
      (segment) => segment.toUpperCase() === "SAVEDATA"
    );
    if (savedataIndex >= 0 && savedataIndex < segments.length - 2) {
      const slot = segments.slice(0, savedataIndex + 2).join(path.sep);
      return titleIdsForGame(game).includes(
        (await savedataIdentity(slot)) ?? ""
      );
    }
    const parsed = stateParts(path.basename(filePath));
    if (!parsed) return false;
    if (parsed.extension === "ppst") return true;
    const primary = `${parsed.prefix}${parsed.undo ? ".undo" : ""}.ppst`;
    const stat = await lstatIfExists(
      path.join(path.dirname(filePath), primary)
    ).catch(() => null);
    return !!stat?.isFile() && !stat.isSymbolicLink();
  };

export const scanPpssppSaveRoot = async (
  { game, environmentId, variantId }: EmulatorProviderContext,
  pspRoot: string
): Promise<EmulatorProviderDiscovery> => {
  const result: EmulatorProviderDiscovery = {
    files: [],
    coverage: [],
    revision: "ppsspp-v1",
  };
  const titleIds = titleIdsForGame(game);
  if (!titleIds.length) {
    result.coverage.push(
      emulatorUnresolvedCoverage("ppsspp", "ppsspp-disc-id-unresolved")
    );
    return result;
  }
  const saveRoot = path.join(pspRoot, "SAVEDATA");
  const stateRoot = path.join(pspRoot, "PPSSPP_STATE");
  const saveEntries = await readDirectoryIfExists(saveRoot).catch(
    () => undefined
  );
  const stateEntries = await readDirectoryIfExists(stateRoot).catch(
    () => undefined
  );
  const stateNames = new Set(stateEntries?.map((entry) => entry.name) ?? []);

  for (const titleId of titleIds) {
    const saveRawPath = `<emulator>/ppsspp/savedata/${titleId}`;
    let saveComplete = saveEntries != null;
    for (const slot of saveEntries ?? []) {
      if (!slot.name.startsWith(titleId)) continue;
      if (!slot.isDirectory() || slot.isSymbolicLink()) {
        saveComplete = false;
        continue;
      }
      const slotRoot = path.join(saveRoot, slot.name);
      const sfoDiscId = await savedataIdentity(slotRoot);
      if (sfoDiscId !== titleId) {
        saveComplete = false;
        continue;
      }
      const scan = await listSafeFiles(slotRoot);
      saveComplete &&= scan.complete;
      for (const absolutePath of scan.files) {
        const relativePath = path
          .relative(saveRoot, absolutePath)
          .split(path.sep)
          .join("/");
        if (!safeRelativeSegments(relativePath)) {
          saveComplete = false;
          continue;
        }
        result.files.push({
          variantId,
          ruleId: emulatorRuleId(saveRawPath),
          rawPath: saveRawPath,
          absolutePath,
          relativePath,
          localBindings: {
            environmentId,
            rootId: emulatorPathHash(JSON.stringify([environmentId, saveRoot])),
            concreteUserSegment: "__default__",
            concretePath: saveRoot,
          },
          confidence: "exact",
          provenance: ["emulator:ppsspp"],
        });
      }
    }
    result.coverage.push(
      emulatorCoverage(
        saveRawPath,
        variantId,
        saveComplete,
        "ppsspp-savedata-partial"
      )
    );

    const stateRawPath = `<emulator>/ppsspp/state/${titleId}`;
    let stateComplete = stateEntries != null;
    for (const entry of stateEntries ?? []) {
      if (!entry.name.startsWith(`${titleId}_`)) continue;
      const parsed = stateParts(entry.name);
      if (!parsed || !entry.isFile() || entry.isSymbolicLink()) {
        stateComplete = false;
        continue;
      }
      const stateName = `${parsed.prefix}${parsed.undo ? ".undo" : ""}.ppst`;
      if (parsed.extension !== "ppst" && !stateNames.has(stateName)) {
        stateComplete = false;
        continue;
      }
      const absolutePath = path.join(stateRoot, entry.name);
      result.files.push({
        variantId,
        ruleId: emulatorRuleId(stateRawPath),
        rawPath: stateRawPath,
        absolutePath,
        relativePath: entry.name,
        localBindings: {
          environmentId,
          rootId: emulatorPathHash(JSON.stringify([environmentId, stateRoot])),
          concreteUserSegment: "__default__",
          concretePath: stateRoot,
        },
        confidence: "exact",
        provenance: ["emulator:ppsspp"],
        stateMetadata: { emulatorId: "ppsspp" },
      });
    }
    result.coverage.push(
      emulatorCoverage(
        stateRawPath,
        variantId,
        stateComplete,
        "ppsspp-state-partial"
      )
    );
  }
  return result;
};

export const resolvePpssppRestoreRules = async (
  game: Game,
  files: Parameters<EmulatorProvider["restoreRules"]>[1],
  pspRoot: string
): Promise<Map<string, CloudSaveRule>> => {
  const allowed = new Set(titleIdsForGame(game));
  const result = new Map<string, CloudSaveRule>();
  const stateFiles = new Set(files.map((file) => file.relativePath));
  for (const file of files) {
    const segments = safeRelativeSegments(file.relativePath);
    if (!segments) continue;
    const save = SAVEDATA_RAW_PATH.exec(file.rawPath);
    const state = STATE_RAW_PATH.exec(file.rawPath);
    if (save && allowed.has(save[1]) && segments.length >= 2) {
      const saveRoot = path.join(pspRoot, "SAVEDATA");
      if (
        !segments[0].startsWith(save[1]) ||
        !(await safeRestorePath(saveRoot, segments))
      )
        continue;
      const existingSlot = await lstatIfExists(
        path.join(saveRoot, segments[0])
      ).catch(() => undefined);
      if (
        existingSlot === undefined ||
        (existingSlot && !existingSlot.isDirectory())
      )
        continue;
      if (
        existingSlot &&
        (await savedataIdentity(path.join(saveRoot, segments[0]))) !== save[1]
      )
        continue;
      result.set(
        emulatorSaveFileKey(file),
        emulatorRestoreRule(file.rawPath, saveRoot, "dir")
      );
    } else if (state && allowed.has(state[1]) && segments.length === 1) {
      const parsed = stateParts(segments[0]);
      if (!parsed || parsed.titleId !== state[1]) continue;
      const stateName = `${parsed.prefix}${parsed.undo ? ".undo" : ""}.ppst`;
      if (parsed.extension !== "ppst" && !stateFiles.has(stateName)) continue;
      const stateRoot = path.join(pspRoot, "PPSSPP_STATE");
      if (!(await safeRestorePath(stateRoot, segments))) continue;
      result.set(
        emulatorSaveFileKey(file),
        emulatorRestoreRule(file.rawPath, stateRoot, "dir")
      );
    }
  }
  return result;
};

export const ppssppSaveProvider: EmulatorProvider = {
  async discover(context) {
    const location = await resolvePpssppSaveLocation().catch(() => null);
    return location
      ? scanPpssppSaveRoot(context, location.pspRoot)
      : {
          files: [],
          coverage: [
            emulatorUnresolvedCoverage("ppsspp", "ppsspp-config-unresolved"),
          ],
          revision: "ppsspp-v1",
        };
  },
  async restoreRules(game, files) {
    const location = await resolvePpssppSaveLocation().catch(() => null);
    return location
      ? resolvePpssppRestoreRules(game, files, location.pspRoot)
      : new Map();
  },
};
