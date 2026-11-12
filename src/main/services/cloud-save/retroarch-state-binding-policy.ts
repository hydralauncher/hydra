import { createHash, randomBytes } from "node:crypto";
import path from "node:path";

import type {
  RetroArchBindingRecord,
  RetroArchStateBinding,
} from "@main/level";
import type { Game, SnapshotFile } from "@types";

import {
  parseRetroArchGameRawPath,
  parseRetroArchSaveRawPath,
  parseRetroArchStateRelativePath,
  retroArchGameRawPath,
  retroArchStateRelativePath,
} from "./emulator-provider-identity.js";

export interface RetroArchObservedState {
  path: string;
  slot: string;
  hash: string;
  romPath: string;
}

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export const legacyRetroArchStateId = (
  game: Game,
  file: Pick<SnapshotFile, "rawPath" | "relativePath">
) =>
  digest(
    JSON.stringify([
      "retroarch-legacy-state",
      game.shop,
      game.objectId,
      file.rawPath,
      file.relativePath,
    ])
  );

export const remoteRetroArchStateId = (game: Game, file: SnapshotFile) => {
  if (parseRetroArchGameRawPath(file.rawPath)) {
    return parseRetroArchStateRelativePath(file.relativePath)?.stateId ?? null;
  }
  if (
    parseRetroArchSaveRawPath(file.rawPath) &&
    /^state\.state(?:\d+|\.auto)?(?:\.png)?$/.test(file.relativePath)
  ) {
    return legacyRetroArchStateId(game, {
      ...file,
      relativePath: file.relativePath.replace(/\.png$/, ""),
    });
  }
  return null;
};

export const reconcileRetroArchStateBindings = (
  game: Game,
  current: RetroArchBindingRecord,
  observed: RetroArchObservedState[],
  remoteFiles: SnapshotFile[] = []
): RetroArchBindingRecord => {
  const existingByPath = new Map(
    current.states.map((state) => [path.resolve(state.path), state])
  );
  const remoteByHash = new Map<string, string[]>();
  const remoteIds = new Set<string>();
  for (const file of remoteFiles) {
    const id = remoteRetroArchStateId(game, file);
    if (!id || file.relativePath.endsWith(".png")) continue;
    remoteIds.add(id);
    const ids = remoteByHash.get(file.hash) ?? [];
    if (!ids.includes(id)) ids.push(id);
    remoteByHash.set(file.hash, ids);
  }
  const next: RetroArchStateBinding[] = [];
  const idsByHash = new Map<string, string>();
  const hashById = new Map<string, string>();
  for (const state of current.states) {
    if (!idsByHash.has(state.hash)) idsByHash.set(state.hash, state.id);
  }
  for (const state of observed) {
    const filePath = path.resolve(state.path);
    const previous = existingByPath.get(filePath);
    const matchingRemote = remoteByHash.get(state.hash);
    const remoteMatch = matchingRemote?.length === 1 ? matchingRemote[0] : null;
    let id =
      (previous && remoteIds.has(previous.id) ? previous.id : remoteMatch) ??
      previous?.id ??
      idsByHash.get(state.hash) ??
      randomBytes(32).toString("hex");
    if (hashById.has(id) && hashById.get(id) !== state.hash) {
      id = randomBytes(32).toString("hex");
    }
    hashById.set(id, state.hash);
    idsByHash.set(state.hash, id);
    next.push({
      id,
      path: filePath,
      slot: state.slot,
      hash: state.hash,
    });
  }
  const observedPaths = new Set(next.map((state) => state.path));
  return {
    ...current,
    states: [
      ...next,
      ...current.states.filter((state) => !observedPaths.has(state.path)),
    ],
  };
};

export const retroArchStateCloudIdentity = (platform: string, id: string) => ({
  rawPath: retroArchGameRawPath(platform),
  relativePath: retroArchStateRelativePath(id),
});
