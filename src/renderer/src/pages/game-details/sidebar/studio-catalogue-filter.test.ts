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

  it("adds the stored combinations that list the studio among others", () => {
    assert.deepEqual(
      buildStudioCatalogueFilter("steam", "publishers", "FromSoftware, Inc.", [
        "FromSoftware, Inc., Bandai Namco Entertainment",
        "Bandai Namco Entertainment, FromSoftware, Inc.",
        "BANDAI NAMCO Entertainment, FromSoftware, Inc.",
        "FromSoftware, Inc., Bandai Namco Entertainment Inc.",
        "FromSoftToHardware",
        "General Arcade, FromSoftware, Inc",
      ]),
      {
        mode: "modern",
        filters: {
          publishers: [
            "FromSoftware, Inc.",
            "FromSoftware, Inc., Bandai Namco Entertainment",
            "Bandai Namco Entertainment, FromSoftware, Inc.",
            "FromSoftware, Inc., Bandai Namco Entertainment Inc.",
          ],
        },
      }
    );
  });

  it("keeps one value per spelling the case-insensitive search folds", () => {
    assert.deepEqual(
      buildStudioCatalogueFilter("steam", "developers", "CAPCOM Co., Ltd.", [
        "CAPCOM CO., LTD.",
        "Capcom",
        "Capcom, Digital Eclipse",
      ]),
      { mode: "modern", filters: { developers: ["CAPCOM Co., Ltd."] } }
    );
  });

  it("matches combinations stored with encoded ampersands", () => {
    assert.deepEqual(
      buildStudioCatalogueFilter("steam", "developers", "Arrow & Blade Games", [
        "Arrow &amp; Blade Games, Other Studio",
        "Arrow & Blade Games, Other Studio",
      ]),
      {
        mode: "modern",
        filters: {
          developers: [
            "Arrow &amp; Blade Games",
            "Arrow &amp; Blade Games, Other Studio",
          ],
        },
      }
    );
  });

  it("ignores the catalogue names for LaunchBox games", () => {
    assert.deepEqual(
      buildStudioCatalogueFilter("launchbox", "developers", "Spike", [
        "Spike, Other",
      ]),
      { mode: "classics", filters: { developers: ["Spike"] } }
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
