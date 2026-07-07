import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCloudSaveTokenMap } from "../path-resolution/tokens.ts";
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

describe("buildCloudSaveTokenMap", () => {
  it("builds the expected token map for a populated steam context", () => {
    const tokenMap = buildCloudSaveTokenMap(createContext());

    assert.deepEqual(tokenMap, {
      "<base>": ["D:/Games/P5R"],
      "<home>": ["C:/Users/Spectre"],
      "<storeUserId>": ["123456789", "987654321"],
      "<winAppData>": ["C:/Users/Spectre/AppData/Roaming"],
      "%APPDATA%": ["C:/Users/Spectre/AppData/Roaming"],
      "<winLocalAppData>": ["C:/Users/Spectre/AppData/Local"],
      "%LOCALAPPDATA%": ["C:/Users/Spectre/AppData/Local"],
      "<winDocuments>": ["C:/Users/Spectre/Documents"],
      "<winPublic>": ["C:/Users/Public"],
      "<winProgramData>": ["C:/ProgramData"],
    });
  });

  it("keeps only <home> when optional token sources are missing", () => {
    const tokenMap = buildCloudSaveTokenMap(
      createContext({
        shop: "gog",
        objectId: "abc",
        platform: "linux",
        documentsDir: null,
        appDataDir: null,
        localAppDataDir: null,
        publicDir: null,
        programDataDir: null,
        installDir: null,
        executablePath: null,
        winePrefixPath: null,
        protonPath: null,
        steamPath: null,
        steamUserIds: [],
        homeDir: "/home/Spectre",
      })
    );

    assert.deepEqual(tokenMap, {
      "<home>": ["/home/Spectre"],
    });
  });

  it("deduplicates values within each token while preserving order", () => {
    const tokenMap = buildCloudSaveTokenMap(
      createContext({
        steamUserIds: ["123456789", "123456789", "987654321"],
      })
    );

    assert.deepEqual(tokenMap["<storeUserId>"], ["123456789", "987654321"]);
  });
});
