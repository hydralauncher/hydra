import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  catalogueSearchSlice,
  setFilters,
  setMode,
  setPage,
  setPcShop,
} from "./catalogue-search.js";

describe("catalogue store selection", () => {
  it("starts on All and resets store filters and pagination when switching", () => {
    const reduce = catalogueSearchSlice.reducer;
    let state = reduce(undefined, { type: "init" });

    assert.equal(state.pcShop, "all");
    state = reduce(
      state,
      setFilters({ title: "Hades", genres: ["Action"], tags: [42] })
    );
    state = reduce(state, setPage(3));
    state = reduce(state, setPcShop("epic"));

    assert.equal(state.pcShop, "epic");
    assert.equal(state.page, 1);
    assert.equal(state.filters.title, "Hades");
    assert.deepEqual(state.filters.genres, []);
    assert.deepEqual(state.filters.tags, []);
  });

  it("preserves All when switching between modern games and Classics", () => {
    const reduce = catalogueSearchSlice.reducer;
    let state = reduce(undefined, { type: "init" });

    state = reduce(state, setMode("classics"));
    assert.equal(state.pcShop, "all");
    state = reduce(state, setMode("modern"));
    assert.equal(state.pcShop, "all");
  });
});
