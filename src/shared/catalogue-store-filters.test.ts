import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getCatalogueSearchShops,
  loadCatalogueStoreFilters,
  parseCatalogueStoreScope,
} from "./catalogue-store-filters.js";

describe("catalogue store filters", () => {
  it("defaults old links to All and preserves explicit store links", () => {
    assert.equal(parseCatalogueStoreScope(null), "all");
    assert.equal(parseCatalogueStoreScope("unknown"), "all");
    assert.equal(parseCatalogueStoreScope("steam"), "steam");
    assert.equal(parseCatalogueStoreScope("epic"), "epic");
    assert.deepEqual(getCatalogueSearchShops("all"), ["steam", "epic"]);
    assert.deepEqual(getCatalogueSearchShops("steam"), ["steam"]);
    assert.deepEqual(getCatalogueSearchShops("epic"), ["epic"]);
  });

  it("merges shared and store-exclusive facets without requesting an All endpoint", async () => {
    const responses: Record<string, string[]> = {
      "/catalogue/steam/genres": ["Action", "Strategy"],
      "/catalogue/steam/developers": ["Shared Studio", "Steam Studio"],
      "/catalogue/steam/publishers": ["Shared Publisher"],
      "/catalogue/epic/genres": ["Action", "Adventure"],
      "/catalogue/epic/developers": ["Shared Studio", "Epic Studio"],
      "/catalogue/epic/publishers": ["Shared Publisher", "Epic Publisher"],
    };
    const requested: string[] = [];

    const filters = await loadCatalogueStoreFilters("all", async (path) => {
      requested.push(path);
      return responses[path];
    });

    assert.deepEqual(requested.sort(), Object.keys(responses).sort());
    assert.deepEqual(filters, {
      genres: ["Action", "Adventure", "Strategy"],
      developers: ["Epic Studio", "Shared Studio", "Steam Studio"],
      publishers: ["Epic Publisher", "Shared Publisher"],
    });
  });

  it("keeps available facets when one store endpoint fails", async () => {
    const failures: string[] = [];
    const filters = await loadCatalogueStoreFilters(
      "all",
      async (path) => {
        if (path === "/catalogue/epic/publishers") throw new Error("offline");
        if (path.endsWith("/publishers")) return ["Steam Publisher"];
        return ["Action"];
      },
      (path) => failures.push(path)
    );

    assert.deepEqual(filters, {
      genres: ["Action"],
      developers: ["Action"],
      publishers: ["Steam Publisher"],
    });
    assert.deepEqual(failures, ["/catalogue/epic/publishers"]);
  });
});
