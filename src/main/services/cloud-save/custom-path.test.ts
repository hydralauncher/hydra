import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  bindCloudSaveCustomPathToLocalPath,
  canonicalizeSelectedCloudSaveCustomPath,
  cloudSaveCustomPathContextFromPathContext,
  cloudSaveCustomPathStorageKey,
  decodeCloudSaveCustomPath,
  encodeCloudSaveCustomPath,
  isLegacyCloudSaveCustomPathRawPath,
  type CloudSaveCustomPathContext,
  validateBoundCloudSaveCustomPathForRestore,
  validateCloudSaveCustomPathForRestore,
} from "./custom-path.ts";

const windowsContext = (
  userName: string,
  drive = "C:"
): CloudSaveCustomPathContext => ({
  platform: "windows",
  homeDir: `${drive}/Users/${userName}`,
  documentsDir: `${drive}/Users/${userName}/Documents`,
  appDataDir: `${drive}/Users/${userName}/AppData/Roaming`,
  localAppDataDir: `${drive}/Users/${userName}/AppData/Local`,
});

const linuxContext = (userName: string): CloudSaveCustomPathContext => ({
  platform: "linux",
  homeDir: `/home/${userName}`,
  xdgDataDir: `/home/${userName}/.local/share`,
  xdgConfigDir: `/home/${userName}/.config`,
});

const wineContext = (
  userName: string,
  winePrefixPath = `/home/${userName}/.local/share/hydra/prefix`
): CloudSaveCustomPathContext => ({
  ...linuxContext(userName),
  windowsCompatibility: true,
  winePrefixPath,
  wineUserProfilePath: `${winePrefixPath}/drive_c/users/steamuser`,
});

const macContext = (userName: string): CloudSaveCustomPathContext => ({
  platform: "mac",
  homeDir: `/Users/${userName}`,
  xdgDataDir: `/Users/${userName}/Library/Application Support`,
  xdgConfigDir: `/Users/${userName}/Library/Preferences`,
});

describe("cloud save custom path codec", () => {
  it("encodes known directories with the same portable tokens as normal saves", () => {
    assert.deepEqual(
      encodeCloudSaveCustomPath(
        "c:\\Users\\Hydra\\AppData\\Roaming\\Game\\",
        windowsContext("Hydra")
      ),
      {
        rawPath: "<custom><windows><winAppData>/Game",
        path: "C:/Users/Hydra/AppData/Roaming/Game",
        platform: "windows",
      }
    );
    assert.equal(
      encodeCloudSaveCustomPath(
        "/home/hydra/.local/share/game/",
        linuxContext("hydra")
      ).rawPath,
      "<custom><linux><xdgData>/game"
    );
    assert.equal(
      encodeCloudSaveCustomPath(
        "/Users/hydra/Library/Application Support/Game",
        macContext("hydra")
      ).rawPath,
      "<custom><mac><xdgData>/Game"
    );
  });

  it("resolves a portable custom path against the receiving device", () => {
    const rawPath = encodeCloudSaveCustomPath(
      "C:/Users/Rodrigo/Documents/Game/Saves",
      windowsContext("Rodrigo")
    ).rawPath;

    assert.equal(rawPath, "<custom><windows><winDocuments>/Game/Saves");
    assert.equal(
      decodeCloudSaveCustomPath(rawPath, windowsContext("Maria", "D:")).path,
      "D:/Users/Maria/Documents/Game/Saves"
    );
  });

  it("binds a remote custom path identity to an explicitly chosen folder", () => {
    const rawPath = "<custom><windows><winDocuments>/Game/Saves";
    const binding = bindCloudSaveCustomPathToLocalPath(
      rawPath,
      "D:/Hydra Saves/Game",
      windowsContext("Maria", "D:")
    );

    assert.equal(binding.rawPath, rawPath);
    assert.equal(binding.path, "D:/Hydra Saves/Game");
    assert.equal(binding.platform, "windows");
  });

  it("binds an unmappable remote identity after a local folder is chosen", () => {
    const rawPath = "<custom><linux><home>/Game/Saves";
    const binding = bindCloudSaveCustomPathToLocalPath(
      rawPath,
      "D:/Hydra Saves/Game",
      windowsContext("Maria", "D:")
    );

    assert.equal(binding.rawPath, rawPath);
    assert.equal(binding.path, "D:/Hydra Saves/Game");
    assert.equal(binding.platform, "windows");
  });

  it("preserves a malformed custom identity after a safe folder is chosen", () => {
    const rawPath = "<custom><bsd>/Game/Saves";
    const binding = bindCloudSaveCustomPathToLocalPath(
      rawPath,
      "D:/Hydra Saves/Game",
      windowsContext("Maria", "D:")
    );

    assert.equal(binding.rawPath, rawPath);
    assert.equal(binding.path, "D:/Hydra Saves/Game");
    assert.equal(binding.platform, "windows");
  });

  it("uses one Windows identity on native Windows and Wine", () => {
    const rawPath = "<custom><windows><winAppData>/Game/Saves";

    assert.equal(
      decodeCloudSaveCustomPath(rawPath, windowsContext("Rodrigo")).path,
      "C:/Users/Rodrigo/AppData/Roaming/Game/Saves"
    );
    assert.equal(
      decodeCloudSaveCustomPath(rawPath, wineContext("maria")).path,
      "/home/maria/.local/share/hydra/prefix/drive_c/users/steamuser/AppData/Roaming/Game/Saves"
    );
  });

  it(
    "uses USERPROFILE from the active prefix instead of enumerating users",
    { skip: process.platform === "win32" },
    async () => {
      const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "hydra-custom-active-wine-profile-")
      );
      const prefix = path.join(directory, "prefix");
      const activeProfile = path.join(prefix, "drive_c", "users", "player-two");
      await Promise.all(
        ["steamuser", "player-two"].map((profile) =>
          fs.mkdir(path.join(prefix, "drive_c", "users", profile), {
            recursive: true,
          })
        )
      );
      await fs.writeFile(
        path.join(prefix, "user.reg"),
        String.raw`WINE REGISTRY Version 2

[Volatile Environment]
"USERPROFILE"="C:\\users\\player-two"
`
      );

      try {
        const context = cloudSaveCustomPathContextFromPathContext({
          objectId: "game",
          platform: "linux",
          homeDir: path.join(directory, "home"),
          executablePath: path.join(directory, "Game", "game.exe"),
          winePrefixPath: prefix,
          storeUserContext: { known: [] },
        });

        assert.equal(
          context.wineUserProfilePath,
          await fs.realpath(activeProfile)
        );
        assert.equal(
          decodeCloudSaveCustomPath(
            "<custom><windows><winDocuments>/Game",
            context
          ).path,
          `${(await fs.realpath(activeProfile)).replaceAll("\\", "/")}/Documents/Game`
        );
      } finally {
        await fs.rm(directory, { recursive: true, force: true });
      }
    }
  );

  it("leaves Windows custom paths unavailable without a valid USERPROFILE", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-custom-missing-wine-profile-")
    );
    const prefix = path.join(directory, "prefix");
    await fs.mkdir(path.join(prefix, "drive_c", "users", "steamuser"), {
      recursive: true,
    });

    try {
      const context = cloudSaveCustomPathContextFromPathContext({
        objectId: "game",
        platform: "linux",
        homeDir: path.join(directory, "home"),
        executablePath: path.join(directory, "Game", "game.exe"),
        winePrefixPath: prefix,
        storeUserContext: { known: [] },
      });

      assert.equal(context.wineUserProfilePath, undefined);
      assert.throws(() =>
        decodeCloudSaveCustomPath(
          "<custom><windows><winDocuments>/Game",
          context
        )
      );
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("encodes a selected Wine profile directory as a Windows custom path", () => {
    const context = wineContext("rodrigo");
    const selectedPath =
      "/home/rodrigo/.local/share/hydra/prefix/drive_c/users/steamuser/AppData/Roaming/Game";

    assert.deepEqual(encodeCloudSaveCustomPath(selectedPath, context), {
      rawPath: "<custom><windows><winAppData>/Game",
      path: selectedPath,
      platform: "windows",
    });
  });

  it("uses only the active Wine profile", () => {
    const context = wineContext("rodrigo");
    assert.equal(
      decodeCloudSaveCustomPath("<custom><windows><winDocuments>/Game", context)
        .path,
      "/home/rodrigo/.local/share/hydra/prefix/drive_c/users/steamuser/Documents/Game"
    );
    assert.throws(() =>
      encodeCloudSaveCustomPath(
        "/home/rodrigo/.local/share/hydra/prefix/drive_c/users/player-two/Documents/Game",
        context
      )
    );
  });

  it("uses base and store-user tokens when the normal resolver can rebase them", () => {
    const sender = windowsContext("Rodrigo");
    sender.installDir = "C:/Games/Sekiro";
    sender.storeUserIds = ["76561198000000001"];
    const rawPath = encodeCloudSaveCustomPath(
      "C:/Games/Sekiro/saves/76561198000000001",
      sender
    ).rawPath;

    assert.equal(rawPath, "<custom><windows><base>/saves/<storeUserId>");

    const receiver = windowsContext("Maria", "D:");
    receiver.installDir = "D:/SteamLibrary/Sekiro";
    receiver.storeUserIds = ["76561198000000002"];
    assert.equal(
      decodeCloudSaveCustomPath(rawPath, receiver).path,
      "D:/SteamLibrary/Sekiro/saves/76561198000000002"
    );
  });

  it("uses the same base identity in Wine and native Windows", () => {
    const sender = wineContext("rodrigo");
    sender.installDir = "/mnt/steam/steamapps/common/Game";
    const rawPath = encodeCloudSaveCustomPath(
      "/mnt/steam/steamapps/common/Game/saves",
      sender
    ).rawPath;
    const receiver = windowsContext("Maria", "D:");
    receiver.installDir = "D:/Games/Game";

    assert.equal(rawPath, "<custom><windows><base>/saves");
    assert.equal(
      decodeCloudSaveCustomPath(rawPath, receiver).path,
      "D:/Games/Game/saves"
    );
  });

  it("rebases custom paths stored under the game store root", () => {
    const sender = wineContext("rodrigo");
    sender.installDir = "/mnt/steam/steamapps/common/Game";
    sender.storeRoot = "/mnt/steam";
    sender.storeUserIds = ["111"];
    const rawPath = encodeCloudSaveCustomPath(
      "/mnt/steam/userdata/111/999/remote",
      sender
    ).rawPath;
    const receiver = windowsContext("Maria", "D:");
    receiver.storeRoot = "D:/SteamLibrary";
    receiver.storeUserIds = ["222"];

    assert.equal(
      rawPath,
      "<custom><windows><root>/userdata/<storeUserId>/999/remote"
    );
    assert.equal(
      decodeCloudSaveCustomPath(rawPath, receiver).path,
      "D:/SteamLibrary/userdata/222/999/remote"
    );
  });

  it("keeps Linux Wine paths platform-specific instead of aliasing them", () => {
    const linuxRawPath =
      "<custom><linux><home>/.local/share/hydra/prefix/drive_c/users/steamuser/AppData/Roaming/Game";

    assert.throws(() =>
      decodeCloudSaveCustomPath(linuxRawPath, windowsContext("Maria", "D:"))
    );
    assert.equal(
      decodeCloudSaveCustomPath(linuxRawPath, wineContext("maria")).path,
      "/home/maria/.local/share/hydra/prefix/drive_c/users/steamuser/AppData/Roaming/Game"
    );
  });

  it("keeps explicit absolute paths platform-specific", () => {
    const rawPath =
      "<custom><linux><absolute>/mnt/backups/drive_c/users/steamuser/Documents/Game";
    assert.equal(
      decodeCloudSaveCustomPath(rawPath, {
        ...linuxContext("hydra"),
        homeDir: "/home/hydra",
      }).path,
      "/mnt/backups/drive_c/users/steamuser/Documents/Game"
    );
    assert.throws(() =>
      decodeCloudSaveCustomPath(rawPath, windowsContext("Hydra"))
    );
  });

  it("keeps explicit absolute paths exact", () => {
    const rawPath =
      "<custom><windows><absolute>C:/Users/Rodrigo/AppData/Roaming/Game";
    const receivingContext = windowsContext("Maria", "D:");
    receivingContext.appDataDir = "E:/Profiles/Maria/Roaming";
    const decoded = decodeCloudSaveCustomPath(rawPath, receivingContext);

    assert.equal(decoded.rawPath, rawPath);
    assert.equal(decoded.path, "C:/Users/Rodrigo/AppData/Roaming/Game");
  });

  it("marks bare absolute paths as legacy and never decodes them", () => {
    const legacyWindows =
      "<custom><windows>C:/Users/Rodrigo/AppData/Roaming/Game";
    const legacyLinux = "<custom><linux>/home/rodrigo/.local/share/game";

    assert.equal(isLegacyCloudSaveCustomPathRawPath(legacyWindows), true);
    assert.equal(isLegacyCloudSaveCustomPathRawPath(legacyLinux), true);
    assert.equal(
      isLegacyCloudSaveCustomPathRawPath("<custom><windows><winAppData>/Game"),
      false
    );
    assert.equal(
      isLegacyCloudSaveCustomPathRawPath(
        "<custom><windows><absolute>D:/Saves/Game"
      ),
      false
    );
    assert.throws(() =>
      decodeCloudSaveCustomPath(legacyWindows, windowsContext("Hydra"))
    );
    assert.throws(() =>
      decodeCloudSaveCustomPath(legacyLinux, linuxContext("hydra"))
    );
  });

  it("encodes new non-portable absolute paths with the explicit marker", () => {
    assert.equal(
      encodeCloudSaveCustomPath("D:/Saves/Game", windowsContext("Hydra"))
        .rawPath,
      "<custom><windows><absolute>D:/Saves/Game"
    );
  });

  it("rejects unknown platforms, relative paths, traversal and roots", () => {
    assert.throws(() =>
      decodeCloudSaveCustomPath(
        "<custom><bsd>/home/hydra/game",
        linuxContext("hydra")
      )
    );
    for (const rawPath of [
      "<custom><linux>relative/game",
      "<custom><linux><absolute>/home/hydra/../game",
      "<custom><linux><home>/../game",
      "<custom><linux><absolute>/",
    ]) {
      assert.throws(() =>
        decodeCloudSaveCustomPath(rawPath, linuxContext("hydra"))
      );
    }
    for (const rawPath of [
      "<custom><windows>c:/Users/Hydra/Game",
      "<custom><windows><absolute>C:/",
      "<custom><windows><absolute>C:/Windows/System32",
      "<custom><windows><xdgData>/Game",
    ]) {
      assert.throws(() =>
        decodeCloudSaveCustomPath(rawPath, windowsContext("Hydra"))
      );
    }
    assert.throws(() =>
      decodeCloudSaveCustomPath(
        "<custom><mac><absolute>/System/Library",
        macContext("hydra")
      )
    );
    assert.throws(() =>
      decodeCloudSaveCustomPath(
        "<custom><windows><absolute>D:/Unmapped/Saves",
        wineContext("hydra")
      )
    );
  });

  it("does not apply a valid path from another platform", async () => {
    assert.equal(
      await validateCloudSaveCustomPathForRestore(
        "<custom><linux><home>/game",
        "windows",
        windowsContext("Hydra")
      ),
      null
    );
  });

  it("isolates persisted paths by Hydra user, shop and objectId", () => {
    assert.notEqual(
      cloudSaveCustomPathStorageKey("user-a", "steam", "1"),
      cloudSaveCustomPathStorageKey("user-b", "steam", "1")
    );
    assert.notEqual(
      cloudSaveCustomPathStorageKey("user-a", "steam", "1"),
      cloudSaveCustomPathStorageKey("user-a", "custom", "1")
    );
    assert.notEqual(
      cloudSaveCustomPathStorageKey("user-a", "steam", "1"),
      cloudSaveCustomPathStorageKey("user-a", "steam", "2")
    );
  });

  it("canonicalizes an existing selected directory", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-custom-path-")
    );
    const context: CloudSaveCustomPathContext = {
      platform:
        process.platform === "win32"
          ? "windows"
          : process.platform === "darwin"
            ? "mac"
            : "linux",
      homeDir: os.homedir(),
    };
    try {
      const customPath = await canonicalizeSelectedCloudSaveCustomPath(
        directory,
        context
      );
      assert.equal(customPath.path, directory.replaceAll("\\", "/"));
      assert.equal(
        decodeCloudSaveCustomPath(customPath.rawPath, context).path,
        customPath.path
      );
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps an approved missing destination valid when its parent is writable", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-custom-path-")
    );
    const context: CloudSaveCustomPathContext = {
      platform:
        process.platform === "win32"
          ? "windows"
          : process.platform === "darwin"
            ? "mac"
            : "linux",
      homeDir: os.homedir(),
    };
    const missingDestination = path.join(directory, "missing");
    try {
      const customPath = await validateBoundCloudSaveCustomPathForRestore(
        "<custom><linux><absolute>/remote/identity",
        missingDestination,
        context
      );
      assert.equal(customPath.path, missingDestination.replaceAll("\\", "/"));
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it(
    "allows a Wine profile directory symlinked into the host home",
    { skip: process.platform === "win32" },
    async () => {
      const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "hydra-custom-wine-symlink-")
      );
      const homeDir = path.join(directory, "home");
      const prefix = path.join(directory, "prefix");
      const hostDocuments = path.join(homeDir, "Documents");
      const wineHome = path.join(prefix, "drive_c", "users", "steamuser");
      const wineDocuments = path.join(wineHome, "Documents");
      await fs.mkdir(hostDocuments, { recursive: true });
      await fs.mkdir(wineHome, { recursive: true });
      await fs.symlink(hostDocuments, wineDocuments, "dir");
      const selected = path.join(wineDocuments, "Game");
      await fs.mkdir(selected);

      try {
        const customPath = await canonicalizeSelectedCloudSaveCustomPath(
          selected,
          {
            ...linuxContext(path.basename(homeDir)),
            homeDir,
            windowsCompatibility: true,
            winePrefixPath: prefix,
            wineUserProfilePath: wineHome,
          }
        );
        assert.equal(
          customPath.rawPath,
          "<custom><windows><winDocuments>/Game"
        );
      } finally {
        await fs.rm(directory, { recursive: true, force: true });
      }
    }
  );
});
