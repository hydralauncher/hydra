import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveFlatpakEmulatorLaunch } from "./flatpak-emulator-launch.js";

const rom = "/home/user/Documentos/ROMS/PS2ROMS/Chaos Legion (BR-USA).iso";
const base = {
  args: ["-batch", "-fullscreen", "--", rom],
  accessiblePaths: [rom],
  flatpakCommand: "/usr/bin/flatpak",
  homePath: "/home/user",
  platform: "linux" as const,
};

describe("Flatpak emulator launch", () => {
  it("runs a system Flatpak export with access to the ROM folder", () => {
    assert.deepEqual(
      resolveFlatpakEmulatorLaunch({
        ...base,
        executableTarget: "/var/lib/flatpak/exports/bin/net.pcsx2.PCSX2",
      }),
      {
        command: "/usr/bin/flatpak",
        args: [
          "run",
          "--system",
          "--filesystem=/home/user/Documentos/ROMS/PS2ROMS",
          "net.pcsx2.PCSX2",
          ...base.args,
        ],
      }
    );
  });

  it("targets the user installation for user Flatpak exports", () => {
    const launch = resolveFlatpakEmulatorLaunch({
      ...base,
      executableTarget:
        "/home/user/.local/share/flatpak/exports/bin/org.duckstation.DuckStation",
    });
    assert.deepEqual(launch?.args.slice(0, 4), [
      "run",
      "--user",
      "--filesystem=/home/user/Documentos/ROMS/PS2ROMS",
      "org.duckstation.DuckStation",
    ]);
  });

  it("keeps the original launch for anything that is not a Flatpak export", () => {
    for (const options of [
      { ...base, executableTarget: "/usr/bin/pcsx2-qt" },
      { ...base, executableTarget: "/home/user/Apps/pcsx2.AppImage" },
      {
        ...base,
        executableTarget: "/var/lib/flatpak/exports/bin/net.pcsx2.PCSX2",
        flatpakCommand: null,
      },
      {
        ...base,
        executableTarget: "/var/lib/flatpak/exports/bin/net.pcsx2.PCSX2",
        platform: "win32" as const,
      },
      {
        ...base,
        executableTarget: "/var/lib/flatpak/exports/bin/net.pcsx2.PCSX2",
        accessiblePaths: [
          "/roms:odd/game.iso",
          "relative/game.iso",
          "/game.iso",
        ],
      },
    ]) {
      assert.equal(resolveFlatpakEmulatorLaunch(options), null);
    }
  });
});
