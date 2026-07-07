import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveCloudSavePath } from "../path-resolution/resolve-path.ts";
import type {
  CloudSavePathResolutionContext,
  CloudSaveTokenMap,
} from "../path-resolution/types.ts";

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

describe("resolveCloudSavePath", () => {
  it("resolves a simple <base> path", () => {
    const context = createContext();
    const tokenMap: CloudSaveTokenMap = {
      "<base>": ["D:/Games/P5R"],
    };

    assert.deepEqual(resolveCloudSavePath("<base>/save/", context, tokenMap), {
      rawPath: "<base>/save/",
      resolvedPaths: ["D:/Games/P5R/save/"],
      unresolvedTokens: [],
    });
  });

  it("resolves a simple <home> path on linux without prefixing it", () => {
    const context = createContext({
      platform: "linux",
      homeDir: "/home/Spectre",
      installDir: "/games/p5r",
      executablePath: "/games/p5r/P5R.exe",
    });
    const tokenMap: CloudSaveTokenMap = {
      "<home>": ["/home/Spectre"],
    };

    assert.deepEqual(
      resolveCloudSavePath("<home>/.config/game", context, tokenMap),
      {
        rawPath: "<home>/.config/game",
        resolvedPaths: ["/home/Spectre/.config/game"],
        unresolvedTokens: [],
      }
    );
  });

  it("resolves multiple <storeUserId> candidates", () => {
    const context = createContext();
    const tokenMap: CloudSaveTokenMap = {
      "<winAppData>": ["C:/Users/Spectre/AppData/Roaming"],
      "<storeUserId>": ["123", "456"],
    };

    assert.deepEqual(
      resolveCloudSavePath(
        "<winAppData>/SEGA/P5R/Steam/<storeUserId>/savedata",
        context,
        tokenMap
      ),
      {
        rawPath: "<winAppData>/SEGA/P5R/Steam/<storeUserId>/savedata",
        resolvedPaths: [
          "C:/Users/Spectre/AppData/Roaming/SEGA/P5R/Steam/123/savedata",
          "C:/Users/Spectre/AppData/Roaming/SEGA/P5R/Steam/456/savedata",
        ],
        unresolvedTokens: [],
      }
    );
  });

  it("resolves %APPDATA% and %LOCALAPPDATA% aliases", () => {
    const context = createContext();
    const tokenMap: CloudSaveTokenMap = {
      "%APPDATA%": ["C:/Users/Spectre/AppData/Roaming"],
      "%LOCALAPPDATA%": ["C:/Users/Spectre/AppData/Local"],
    };

    assert.deepEqual(
      resolveCloudSavePath("%APPDATA%/Game/settings.ini", context, tokenMap),
      {
        rawPath: "%APPDATA%/Game/settings.ini",
        resolvedPaths: ["C:/Users/Spectre/AppData/Roaming/Game/settings.ini"],
        unresolvedTokens: [],
      }
    );

    assert.deepEqual(
      resolveCloudSavePath("%LOCALAPPDATA%/Game/cache", context, tokenMap),
      {
        rawPath: "%LOCALAPPDATA%/Game/cache",
        resolvedPaths: ["C:/Users/Spectre/AppData/Local/Game/cache"],
        unresolvedTokens: [],
      }
    );
  });

  it("converts windows-like linux paths into absolute paths inside the wine prefix", () => {
    const context = createContext({
      platform: "linux",
      homeDir: "/home/Spectre",
      documentsDir: "drive_c/users/Spectre/Documents",
      appDataDir: "drive_c/users/Spectre/AppData/Roaming",
      localAppDataDir: "drive_c/users/Spectre/AppData/Local",
      publicDir: "drive_c/users/Public",
      programDataDir: "drive_c/ProgramData",
      installDir: "/games/p5r",
      executablePath: "/games/p5r/P5R.exe",
      winePrefixPath: "/home/Spectre/pfx",
    });
    const tokenMap: CloudSaveTokenMap = {
      "<winAppData>": ["drive_c/users/Spectre/AppData/Roaming"],
      "<storeUserId>": ["123"],
    };

    assert.deepEqual(
      resolveCloudSavePath(
        "<winAppData>/SEGA/P5R/Steam/<storeUserId>/savedata",
        context,
        tokenMap
      ),
      {
        rawPath: "<winAppData>/SEGA/P5R/Steam/<storeUserId>/savedata",
        resolvedPaths: [
          "/home/Spectre/pfx/drive_c/users/Spectre/AppData/Roaming/SEGA/P5R/Steam/123/savedata",
        ],
        unresolvedTokens: [],
      }
    );
  });

  it("returns unresolved tokens in stable order when any token is missing", () => {
    const context = createContext();
    const tokenMap: CloudSaveTokenMap = {
      "<winAppData>": ["C:/Users/Spectre/AppData/Roaming"],
    };

    assert.deepEqual(
      resolveCloudSavePath(
        "<winAppData>/SEGA/P5R/Steam/<storeUserId>/savedata",
        context,
        tokenMap
      ),
      {
        rawPath: "<winAppData>/SEGA/P5R/Steam/<storeUserId>/savedata",
        resolvedPaths: [],
        unresolvedTokens: ["<storeUserId>"],
      }
    );
  });

  it("deduplicates repeated final paths", () => {
    const context = createContext();
    const tokenMap: CloudSaveTokenMap = {
      "<base>": ["D:/Games/P5R", "D:/Games/P5R"],
    };

    assert.deepEqual(resolveCloudSavePath("<base>/save/", context, tokenMap), {
      rawPath: "<base>/save/",
      resolvedPaths: ["D:/Games/P5R/save/"],
      unresolvedTokens: [],
    });
  });

  it("preserves glob patterns in the final path", () => {
    const context = createContext();
    const tokenMap: CloudSaveTokenMap = {
      "<base>": ["D:/Games/P5R"],
    };

    assert.deepEqual(
      resolveCloudSavePath("<base>/valve/*.cfg", context, tokenMap),
      {
        rawPath: "<base>/valve/*.cfg",
        resolvedPaths: ["D:/Games/P5R/valve/*.cfg"],
        unresolvedTokens: [],
      }
    );
  });
});
