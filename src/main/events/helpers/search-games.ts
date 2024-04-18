import flexSearch from "flexsearch";
import orderBy from "lodash/orderBy";

import type { GameRepack, GameShop, CatalogueEntry } from "@types";

import { formatName, getSteamAppAsset, repackerFormatter } from "@main/helpers";
import { stateManager } from "@main/state-manager";
import { steamGameRepository } from "@main/repository";
import { FindManyOptions, Like } from "typeorm";
import { SteamGame } from "@main/entity";

const { Index } = flexSearch;
const repacksIndex = new Index();

const repacks = stateManager.getValue("repacks");

for (let i = 0; i < repacks.length; i++) {
  const repack = repacks[i];
  const formatter =
    repackerFormatter[repack.repacker as keyof typeof repackerFormatter];

  repacksIndex.add(i, formatName(formatter(repack.title)));
}

export const searchRepacks = (title: string): GameRepack[] => {
  const repacks = stateManager.getValue("repacks");

  return orderBy(
    repacksIndex
      .search(formatName(title))
      .map((index) => repacks.at(index as number)!),
    ["uploadDate"],
    "desc"
  );
};

export interface SearchGamesArgs {
  query?: string;
  take?: number;
  skip?: number;
}

export const searchGames = async ({
  query,
  take,
  skip,
}: SearchGamesArgs): Promise<CatalogueEntry[]> => {
  const options: FindManyOptions<SteamGame> = {};

  if (query) {
    options.where = {
      name: query ? Like(`%${formatName(query)}%`) : undefined,
    };
  }

  const steamResults = await steamGameRepository.find({
    ...options,
    take,
    skip,
    order: { name: "ASC" },
  });

  const results = steamResults.map((result) => ({
    objectID: String(result.id),
    title: result.name,
    shop: "steam" as GameShop,
    cover: getSteamAppAsset("library", String(result.id)),
  }));

  return Promise.all(
    results.map(async (result) => ({
      ...result,
      repacks: searchRepacks(result.title),
    }))
  ).then((resultsWithRepacks) =>
    orderBy(
      resultsWithRepacks,
      [({ repacks }) => repacks.length, "repacks"],
      ["desc"]
    )
  );
};
