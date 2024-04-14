import { repackRepository } from "@main/repository";

import type { GameRepack } from "@types";

export type GameRepackInput = Omit<
  GameRepack,
  "id" | "repackerFriendlyName" | "createdAt" | "updatedAt"
>;

export const savePage = async (repacks: GameRepackInput[]) =>
  Promise.all(
    repacks.map((repack) => repackRepository.insert(repack).catch(() => {}))
  );

export const requestWebPage = async (url: string) =>
  fetch(url, {
    method: "GET",
  }).then((response) => response.text());
