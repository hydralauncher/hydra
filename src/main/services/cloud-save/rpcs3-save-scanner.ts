import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { UserLocationCoverage } from "@types";

import { parseParamSfoValue } from "../emulators/param-sfo.js";
import {
  rpcs3SaveRawPath,
  safeRelativeSegments,
} from "./emulator-provider-identity.js";
import type {
  EmulatorProviderContext,
  EmulatorProviderDiscovery,
} from "./emulator-provider-types";
import {
  rpcs3SlotBelongsToTitle,
  rpcs3TitleIdsForGame,
} from "./rpcs3-save-layout.js";

const PROFILE_ID = /^\d{8}$/;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const listSafeFiles = async (root: string) => {
  const files: string[] = [];
  const stack = [root];
  let complete = true;
  while (stack.length) {
    const current = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      complete = false;
      continue;
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        complete = false;
      } else if (entry.isDirectory()) {
        stack.push(target);
      } else if (entry.isFile()) {
        files.push(target);
      }
    }
  }
  return { files, complete };
};

const coverage = (
  rawPath: string,
  variantId: string,
  complete: boolean
): UserLocationCoverage => ({
  candidateId: hash(rawPath),
  ruleId: hash(JSON.stringify(["emulator", rawPath])),
  variantId,
  rawPath,
  selectedRoot: true,
  authority: "exact",
  outcome: complete ? "scanned" : "partial",
  enumeratedCompletely: complete,
  warningCodes: complete ? [] : ["emulator-location-partial"],
});

export const unresolvedCoverage = (reason: string): UserLocationCoverage => ({
  candidateId: hash(reason),
  ruleId: hash("emulator:rpcs3"),
  rawPath: "<emulator>/rpcs3/unresolved",
  selectedRoot: false,
  authority: "inferred",
  outcome: "unresolved",
  enumeratedCompletely: false,
  warningCodes: [reason],
});

export const scanRpcs3SaveRoot = async (
  { game, environmentId, variantId }: EmulatorProviderContext,
  homeRoot: string,
  activeProfileId: string,
  cloudProfileId = activeProfileId
): Promise<EmulatorProviderDiscovery> => {
  const result: EmulatorProviderDiscovery = {
    files: [],
    coverage: [],
    revision: "rpcs3-v1",
  };
  const titleIds = rpcs3TitleIdsForGame(game);
  if (!titleIds.length) {
    result.coverage.push(unresolvedCoverage("rpcs3-title-id-unresolved"));
    return result;
  }
  const profiles = await fs
    .readdir(homeRoot, { withFileTypes: true })
    .catch(() => null);
  if (!profiles) {
    result.coverage.push(unresolvedCoverage("rpcs3-profiles-unresolved"));
    return result;
  }
  for (const profile of profiles) {
    if (profile.name !== activeProfileId) continue;
    if (!profile.isDirectory() || !PROFILE_ID.test(profile.name)) {
      result.coverage.push(unresolvedCoverage("rpcs3-active-profile-invalid"));
      return result;
    }
    const saveRoot = path.join(homeRoot, profile.name, "savedata");
    const slots = await fs
      .readdir(saveRoot, { withFileTypes: true })
      .catch(() => null);
    if (!slots) continue;
    for (const titleId of titleIds) {
      const rawPath = rpcs3SaveRawPath(titleId, cloudProfileId);
      let complete = true;
      for (const slot of slots) {
        if (!rpcs3SlotBelongsToTitle(slot.name, titleId)) continue;
        if (!slot.isDirectory() || slot.isSymbolicLink()) {
          complete = false;
          continue;
        }
        const slotRoot = path.join(saveRoot, slot.name);
        const sfoPath = path.join(slotRoot, "PARAM.SFO");
        const sfo = await fs.readFile(sfoPath).catch(() => null);
        const savedataDirectory = sfo
          ? parseParamSfoValue(sfo, "SAVEDATA_DIRECTORY")
          : null;
        if (sfo && !savedataDirectory) {
          complete = false;
          continue;
        }
        if (
          savedataDirectory &&
          savedataDirectory.replace(/[^A-Za-z0-9]/g, "").toUpperCase() !==
            slot.name.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
        ) {
          complete = false;
          continue;
        }
        const scanned = await listSafeFiles(slotRoot);
        complete &&= scanned.complete;
        for (const absolutePath of scanned.files) {
          const relativePath = path
            .relative(saveRoot, absolutePath)
            .split(path.sep)
            .join("/");
          if (!safeRelativeSegments(relativePath)) {
            complete = false;
            continue;
          }
          result.files.push({
            variantId,
            ruleId: hash(JSON.stringify(["emulator", rawPath])),
            rawPath,
            absolutePath,
            relativePath,
            localBindings: {
              environmentId,
              rootId: hash(JSON.stringify([environmentId, saveRoot])),
              concreteUserSegment: profile.name,
              concretePath: saveRoot,
            },
            confidence: "exact",
            provenance: ["emulator:rpcs3"],
          });
        }
      }
      result.coverage.push(coverage(rawPath, variantId, complete));
    }
  }
  if (!profiles.some((profile) => profile.name === activeProfileId)) {
    result.coverage.push(unresolvedCoverage("rpcs3-active-profile-missing"));
  }
  return result;
};
