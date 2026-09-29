import path from "node:path";

import { cloudSaveEmulatorCardPathsSublevel, db, levelKeys } from "@main/level";
import type { Game, User } from "@types";

import { CloudSaveOperationCoordinator } from "./operation-coordinator";

export type EmulatorCardProvider = "duckstation" | "pcsx2" | "dolphin";
export interface EmulatorCardPathOverride {
  path: string;
  slot: string;
}

const coordinator = new CloudSaveOperationCoordinator<void>();
let mutationId = 0;

const isValidSlot = (provider: EmulatorCardProvider, slot: string) => {
  if (provider === "duckstation") return /^[1-8]$/.test(slot);
  if (provider === "pcsx2") return /^(?:[12]|m[12]s[123])$/.test(slot);
  return slot === "A" || slot === "B";
};

const keyFor = async (game: Game, provider: EmulatorCardProvider) => {
  const user = await db.get<string, User>(levelKeys.user, {
    valueEncoding: "json",
  });
  if (!user?.id) throw new Error("cloud_save_user_required");
  return JSON.stringify([user.id, game.shop, game.objectId, provider]);
};

const normalize = (value: unknown, provider: EmulatorCardProvider) => {
  if (!Array.isArray(value)) return [];
  const bySlot = new Map<string, EmulatorCardPathOverride>();
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.path !== "string" ||
      !path.isAbsolute(item.path) ||
      typeof item.slot !== "string" ||
      !isValidSlot(provider, item.slot)
    ) {
      continue;
    }
    bySlot.set(item.slot, { path: item.path, slot: item.slot });
  }
  return [...bySlot.values()].sort((a, b) => a.slot.localeCompare(b.slot));
};

export const getEmulatorCardPathOverrides = async (
  game: Game,
  provider: EmulatorCardProvider
): Promise<EmulatorCardPathOverride[]> =>
  normalize(
    await cloudSaveEmulatorCardPathsSublevel.get(await keyFor(game, provider)),
    provider
  );

export const registerEmulatorCardPathOverride = async (
  game: Game,
  provider: EmulatorCardProvider,
  filePath: string,
  slot: string
) => {
  if (!path.isAbsolute(filePath) || !isValidSlot(provider, slot)) {
    throw new Error("cloud_save_emulator_card_override_invalid");
  }
  const key = await keyFor(game, provider);
  await coordinator.run(key, `emulator-card:${++mutationId}`, async () => {
    const current = normalize(
      await cloudSaveEmulatorCardPathsSublevel.get(key),
      provider
    );
    const updated = current.filter((item) => item.slot !== slot);
    updated.push({ path: filePath, slot });
    await cloudSaveEmulatorCardPathsSublevel.put(
      key,
      updated.sort((a, b) => a.slot.localeCompare(b.slot))
    );
  });
};

export const removeEmulatorCardPathOverride = async (
  game: Game,
  provider: EmulatorCardProvider,
  slot: string
) => {
  if (!isValidSlot(provider, slot)) return;
  const key = await keyFor(game, provider);
  await coordinator.run(key, `emulator-card:${++mutationId}`, async () => {
    const updated = normalize(
      await cloudSaveEmulatorCardPathsSublevel.get(key),
      provider
    ).filter((item) => item.slot !== slot);
    if (updated.length)
      await cloudSaveEmulatorCardPathsSublevel.put(key, updated);
    else await cloudSaveEmulatorCardPathsSublevel.del(key);
  });
};
