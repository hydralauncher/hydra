import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as studioFilterModule from "./studio-catalogue-filter.ts";

const { buildStudioCatalogueFilter } = studioFilterModule;

describe("buildStudioCatalogueFilter", () => {
  it("encodes Steam names the way the catalogue stores them", () => {
    assert.deepEqual(
      buildStudioCatalogueFilter("steam", "developers", "Arrow & Blade Games"),
      { mode: "modern", filters: { developers: ["Arrow &amp; Blade Games"] } }
    );
  });

  it("leaves plain Steam names untouched", () => {
    assert.deepEqual(
      buildStudioCatalogueFilter("steam", "publishers", "CAPCOM Co., Ltd."),
      { mode: "modern", filters: { publishers: ["CAPCOM Co., Ltd."] } }
    );
  });

  it("encodes quotes for Epic games, which search the modern catalogue", () => {
    assert.deepEqual(
      buildStudioCatalogueFilter(
        "epic",
        "developers",
        'Aaron "Koss" Parpaiola'
      ),
      {
        mode: "modern",
        filters: { developers: ["Aaron &quot;Koss&quot; Parpaiola"] },
      }
    );
  });

  it("opens classics with the raw name for LaunchBox games", () => {
    assert.deepEqual(
      buildStudioCatalogueFilter(
        "launchbox",
        "publishers",
        "Ak Tronic Software & Services"
      ),
      {
        mode: "classics",
        filters: { publishers: ["Ak Tronic Software & Services"] },
      }
    );
  });
});
