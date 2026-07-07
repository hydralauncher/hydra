import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildHydraManifestIndex } from "../manifest/indexer.ts";

describe("buildHydraManifestIndex", () => {
  it("builds a compact manifest index and ignores entries without files", () => {
    const index = buildHydraManifestIndex(
      `
"0": {}
"1687950":
  files:
    <winAppData>/SEGA/P5R/Steam/<storeUserId>:
      tags:
        - config
      when:
        - os: windows
          store: steam
    <winAppData>/SEGA/P5R/Steam/<storeUserId>/savedata:
      tags:
        - save
      when:
        - os: windows
          store: steam
    <winAppData>/Goldberg SteamEmu Saves/1687950: {}
`,
      "https://cdn.losbroxas.org/manifest.yaml",
      1_750_000_000_000
    );

    assert.deepEqual(index, {
      version: 1,
      fetchedAt: 1_750_000_000_000,
      sourceUrl: "https://cdn.losbroxas.org/manifest.yaml",
      games: {
        "1687950": {
          manifestKey: "1687950",
          files: [
            {
              rawPath: "<winAppData>/SEGA/P5R/Steam/<storeUserId>",
              tags: ["config"],
              when: [{ os: "windows", store: "steam" }],
            },
            {
              rawPath: "<winAppData>/SEGA/P5R/Steam/<storeUserId>/savedata",
              tags: ["save"],
              when: [{ os: "windows", store: "steam" }],
            },
            {
              rawPath: "<winAppData>/Goldberg SteamEmu Saves/1687950",
              tags: [],
              when: [],
            },
          ],
        },
      },
    });
  });

  it("throws when the input YAML is invalid", () => {
    assert.throws(() => {
      buildHydraManifestIndex(`"1687950": [`, "https://cdn.losbroxas.org");
    });
  });
});
