import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import type { GamePlayStatus, GameShop } from "@types";

interface UpdateGameCollectionsPayload {
  shop: GameShop;
  objectId: string;
  tags?: string[];
  playStatus?: GamePlayStatus | null;
}

const sanitizeTags = (rawTags?: string[]): string[] => {
  if (!rawTags || !Array.isArray(rawTags)) return [];

  const normalized = rawTags
    .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
    .filter((tag) => tag.length > 0)
    .slice(0, 20);

  return Array.from(new Set(normalized));
};

const updateGameCollections = async (
  _event: Electron.IpcMainInvokeEvent,
  payload: UpdateGameCollectionsPayload
) => {
  const { shop, objectId, tags, playStatus } = payload;

  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game) return;

  const nextTags = sanitizeTags(tags ?? game.tags);

  await gamesSublevel.put(gameKey, {
    ...game,
    tags: nextTags,
    playStatus: playStatus ?? game.playStatus ?? undefined,
  });
};

registerEvent("updateGameCollections", updateGameCollections);
