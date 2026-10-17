import fs from "node:fs";
import path from "node:path";
import { gameKey, modsStatePath } from "./paths";
import type { GameModState } from "../../../types/mods.types";

const emptyState = (): GameModState => ({
  community: null,
  loader: null,
  installed: {},
});

export const readState = async (
  shop: string,
  objectId: string
): Promise<GameModState> => {
  try {
    const raw = await fs.promises.readFile(
      path.join(modsStatePath, `${gameKey(shop, objectId)}.json`),
      "utf8"
    );
    return { ...emptyState(), ...JSON.parse(raw) };
  } catch {
    return emptyState();
  }
};

export const writeState = async (
  shop: string,
  objectId: string,
  state: GameModState
) => {
  await fs.promises.mkdir(modsStatePath, { recursive: true });
  const file = path.join(modsStatePath, `${gameKey(shop, objectId)}.json`);
  const tmp = `${file}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.promises.rename(tmp, file); // atomic replace, no half-written state
};

const locks = new Map<string, Promise<unknown>>();

/** Serialises operations per game so installs/uninstalls never interleave. */
export const withGameLock = <T>(
  shop: string,
  objectId: string,
  task: () => Promise<T>
): Promise<T> => {
  const key = gameKey(shop, objectId);
  const run = (locks.get(key) ?? Promise.resolve()).then(task, task);
  locks.set(
    key,
    run.catch(() => {})
  );
  return run;
};
