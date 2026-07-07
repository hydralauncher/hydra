import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CloudSaveRule } from "../manifest/types.ts";
import { resolveSaveRules } from "../path-resolution/resolve-rules.ts";
import type { CloudSavePathResolutionContext } from "../path-resolution/types.ts";

const createContext = (
  overrides: Partial<CloudSavePathResolutionContext> = {}
): CloudSavePathResolutionContext => {
  return {
    shop: "steam",
    objectId: "1687950",
    platform: "windows",
    homeDir: "C:/Users/Spectre",
    documentsDir: "C:/Users/Spectre/Documents",
    appDataDir: "C:/Users/Spectre/AppData/Roaming",
    localAppDataDir: "C:/Users/Spectre/AppData/Local",
    publicDir: "C:/Users/Public",
    programDataDir: "C:/ProgramData",
    installDir: "D:/Games/P5R",
    executablePath: "D:/Games/P5R/P5R.exe",
    winePrefixPath: null,
    protonPath: null,
    steamPath: "C:/Program Files (x86)/Steam",
    steamUserIds: ["123456789", "987654321"],
    ...overrides,
  };
};

describe("resolveSaveRules", () => {
  it("resolves a mixed rule list while preserving order and rule fields", () => {
    const context = createContext();
    const rules: CloudSaveRule[] = [
      {
        kind: "dir",
        rawPath: "<base>/save/",
        source: "ludusavi",
        tags: ["save"],
        when: [],
      },
      {
        kind: "dir",
        rawPath: "<winAppData>/SEGA/P5R/Steam/<storeUserId>/savedata",
        source: "ludusavi",
        tags: ["save"],
        when: [{ os: "windows", store: "steam" }],
      },
      {
        kind: "file",
        rawPath: "<winDocuments>/missing/<storeUserId>/config.ini",
        source: "ludusavi",
        tags: ["config"],
        when: [],
      },
    ];

    const result = resolveSaveRules(rules, context);

    assert.deepEqual(result, [
      {
        kind: "dir",
        rawPath: "<base>/save/",
        source: "ludusavi",
        tags: ["save"],
        when: [],
        resolvedPaths: ["D:/Games/P5R/save/"],
        unresolvedTokens: [],
      },
      {
        kind: "dir",
        rawPath: "<winAppData>/SEGA/P5R/Steam/<storeUserId>/savedata",
        source: "ludusavi",
        tags: ["save"],
        when: [{ os: "windows", store: "steam" }],
        resolvedPaths: [
          "C:/Users/Spectre/AppData/Roaming/SEGA/P5R/Steam/123456789/savedata",
          "C:/Users/Spectre/AppData/Roaming/SEGA/P5R/Steam/987654321/savedata",
        ],
        unresolvedTokens: [],
      },
      {
        kind: "file",
        rawPath: "<winDocuments>/missing/<storeUserId>/config.ini",
        source: "ludusavi",
        tags: ["config"],
        when: [],
        resolvedPaths: [
          "C:/Users/Spectre/Documents/missing/123456789/config.ini",
          "C:/Users/Spectre/Documents/missing/987654321/config.ini",
        ],
        unresolvedTokens: [],
      },
    ]);

    assert.deepEqual(rules, [
      {
        kind: "dir",
        rawPath: "<base>/save/",
        source: "ludusavi",
        tags: ["save"],
        when: [],
      },
      {
        kind: "dir",
        rawPath: "<winAppData>/SEGA/P5R/Steam/<storeUserId>/savedata",
        source: "ludusavi",
        tags: ["save"],
        when: [{ os: "windows", store: "steam" }],
      },
      {
        kind: "file",
        rawPath: "<winDocuments>/missing/<storeUserId>/config.ini",
        source: "ludusavi",
        tags: ["config"],
        when: [],
      },
    ]);
  });

  it("keeps unresolved rules in the result instead of filtering them out", () => {
    const context = createContext({
      documentsDir: null,
      steamUserIds: [],
    });
    const rules: CloudSaveRule[] = [
      {
        kind: "file",
        rawPath: "<winDocuments>/missing/<storeUserId>/config.ini",
        source: "ludusavi",
        tags: ["config"],
        when: [],
      },
    ];

    const result = resolveSaveRules(rules, context);

    assert.deepEqual(result, [
      {
        kind: "file",
        rawPath: "<winDocuments>/missing/<storeUserId>/config.ini",
        source: "ludusavi",
        tags: ["config"],
        when: [],
        resolvedPaths: [],
        unresolvedTokens: ["<storeUserId>", "<winDocuments>"],
      },
    ]);
  });
});
