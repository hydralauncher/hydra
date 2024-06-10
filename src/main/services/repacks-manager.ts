import { repackRepository } from "@main/repository";
import { formatName } from "@shared";
import { CatalogueEntry, GameRepack } from "@types";
import flexSearch from "flexsearch";

export class RepacksManager {
  public static repacks: GameRepack[] = [];
  private static repacksIndex = new flexSearch.Index();

  public static async updateRepacks() {
    this.repacks = await repackRepository.find({
      order: {
        createdAt: "DESC",
      },
    });

    for (let i = 0; i < this.repacks.length; i++) {
      this.repacksIndex.remove(i);
    }

    this.repacksIndex = new flexSearch.Index();

    for (let i = 0; i < this.repacks.length; i++) {
      const repack = this.repacks[i];

      const formattedTitle = formatName(repack.title);

      this.repacksIndex.add(i, formattedTitle);
    }
  }

  public static search(options: flexSearch.SearchOptions) {
    return this.repacksIndex
      .search({ ...options, query: formatName(options.query ?? "") })
      .map((index) => this.repacks[index]);
  }

  public static findRepacksForCatalogueEntries(entries: CatalogueEntry[]) {
    return entries.map((entry) => {
      const repacks = this.search({ query: formatName(entry.title) });
      return { ...entry, repacks };
    });
  }
}
