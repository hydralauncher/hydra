import { formatName } from "@shared";
import { CatalogueEntry, GameRepack } from "@types";
import flexSearch from "flexsearch";

const repacksIndex = new flexSearch.Index();

const state: { repacks: GameRepack[] } = { repacks: [] };

export const setRepacks = (repacks: GameRepack[]) => {
  for (let i = 0; i < state.repacks.length; i++) {
    repacksIndex.remove(i);
  }

  state.repacks = repacks;

  for (let i = 0; i < repacks.length; i++) {
    const repack = repacks[i];

    const formattedTitle = formatName(repack.title);

    repacksIndex.add(i, formattedTitle);
  }
};

export const search = (options: flexSearch.SearchOptions) =>
  repacksIndex
    .search({ ...options, query: formatName(options.query ?? "") })
    .map((index) => state.repacks[index]);

export const list = () => state.repacks;

export const findRepacksForCatalogueEntries = (entries: CatalogueEntry[]) => {
  return entries.map((entry) => {
    const repacks = search({ query: formatName(entry.title) });
    return { ...entry, repacks };
  });
};
