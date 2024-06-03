import flexSearch from "flexsearch";

import { repackRepository } from "@main/repository";
import { formatName } from "@shared";
import type { GameRepack } from "@types";

export class SearchEngine {
  public static repacks: GameRepack[] = [];

  private static repacksIndex = new flexSearch.Index();

  public static searchRepacks(query: string): GameRepack[] {
    return this.repacksIndex
      .search(formatName(query))
      .map((index) => this.repacks[index]);
  }

  public static async updateRepacks() {
    this.repacks = [];

    const repacks = await repackRepository.find({
      order: {
        createdAt: "desc",
      },
    });

    for (let i = 0; i < repacks.length; i++) {
      const repack = repacks[i];

      const formattedTitle = formatName(repack.title);

      this.repacks = [...this.repacks, { ...repack, title: formattedTitle }];
      this.repacksIndex.add(i, formattedTitle);
    }
  }
}
