import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildSteamGameLaunchUrl,
  findSteamAppInstallDirectories,
  getSteamCompatibilityPrefixPath,
  isPathInsideSteamInstallDirectory,
} from "./steam-installation-core.ts";

const createLibrary = async () => {
  const library = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-steam-library-")
  );
  await fs.promises.mkdir(path.join(library, "steamapps", "common"), {
    recursive: true,
  });
  return library;
};

const writeManifest = async (
  library: string,
  fileAppId: string,
  manifestAppId: string,
  installDirectory: string
) => {
  await fs.promises.writeFile(
    path.join(library, "steamapps", `appmanifest_${fileAppId}.acf`),
    `"AppState"
{
  "appid" "${manifestAppId}"
  "installdir" "${installDirectory}"
}`
  );
};

test("finds the exact app installation in a secondary Steam library", async (t) => {
  const primary = await createLibrary();
  const secondary = await createLibrary();
  t.after(async () => {
    await Promise.all([
      fs.promises.rm(primary, { recursive: true, force: true }),
      fs.promises.rm(secondary, { recursive: true, force: true }),
    ]);
  });

  const installDirectory = path.join(
    secondary,
    "steamapps",
    "common",
    "Portal 2"
  );
  await fs.promises.mkdir(installDirectory);
  await writeManifest(secondary, "620", "620", "Portal 2");

  const installations = await findSteamAppInstallDirectories(
    ["620"],
    [primary, secondary]
  );

  assert.equal(installations.get("620"), installDirectory);
});

test("ignores a manifest whose app id does not match its file", async (t) => {
  const library = await createLibrary();
  t.after(() => fs.promises.rm(library, { recursive: true, force: true }));

  await fs.promises.mkdir(
    path.join(library, "steamapps", "common", "Wrong Game")
  );
  await writeManifest(library, "620", "730", "Wrong Game");

  const installations = await findSteamAppInstallDirectories(
    ["620"],
    [library]
  );

  assert.equal(installations.size, 0);
});

test("rejects install directories outside steamapps/common", async (t) => {
  const library = await createLibrary();
  t.after(() => fs.promises.rm(library, { recursive: true, force: true }));

  const outsideDirectory = path.join(library, "outside");
  await fs.promises.mkdir(outsideDirectory);
  await writeManifest(library, "620", "620", "../../outside");

  const installations = await findSteamAppInstallDirectories(
    ["620"],
    [library]
  );

  assert.equal(installations.size, 0);
});

test("matches only executables inside the exact Steam app installation", () => {
  assert.equal(
    isPathInsideSteamInstallDirectory(
      String.raw`D:\SteamLibrary\steamapps\common\Portal 2\portal2.exe`,
      String.raw`d:\steamlibrary\SteamApps\Common\Portal 2`,
      "win32"
    ),
    true
  );
  assert.equal(
    isPathInsideSteamInstallDirectory(
      "/Users/me/Library/Application Support/Steam/steamapps/common/Game/Game.app/Contents/MacOS/Game",
      "/Users/me/Library/Application Support/Steam/steamapps/common/Game",
      "darwin"
    ),
    true
  );
  assert.equal(
    isPathInsideSteamInstallDirectory(
      "/mnt/steam/steamapps/common/Portal 2/bin/portal2",
      "/mnt/steam/steamapps/common/Portal 2",
      "linux"
    ),
    true
  );

  for (const executablePath of [
    String.raw`D:\SteamLibrary\steamapps\common\Portal 2 copy\portal2.exe`,
    String.raw`D:\SteamLibrary\steamapps\common\Portal 2\..\Other\game.exe`,
  ]) {
    assert.equal(
      isPathInsideSteamInstallDirectory(
        executablePath,
        String.raw`D:\SteamLibrary\steamapps\common\Portal 2`,
        "win32"
      ),
      false
    );
  }
});

test("derives the Steam Proton prefix from the app installation", () => {
  assert.equal(
    getSteamCompatibilityPrefixPath(
      "/mnt/steam/steamapps/common/Portal 2",
      "620"
    ),
    "/mnt/steam/steamapps/compatdata/620/pfx"
  );
});

test("passes plain launch arguments through the Steam protocol", () => {
  assert.equal(buildSteamGameLaunchUrl("620"), "steam://rungameid/620");
  assert.equal(
    buildSteamGameLaunchUrl("620", " -novid -language pt-BR "),
    "steam://run/620//-novid%20-language%20pt-BR/"
  );
  assert.equal(
    buildSteamGameLaunchUrl("620", "mangohud %command%"),
    "steam://rungameid/620"
  );
  assert.equal(
    buildSteamGameLaunchUrl(
      "620",
      'mangohud %command% -novid -name "Portal Test"'
    ),
    "steam://run/620//-novid%20-name%20%22Portal%20Test%22/"
  );
});
