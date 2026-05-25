import type { EmulatorBinary, EmulatorSystem } from "@types";

export interface KnownBinary {
  system: EmulatorSystem;
  binary: EmulatorBinary;
  displayName: string;
  linuxNames: string[];
  windowsNames: string[];
  flatpakIds: string[];
  versionFlags: string[];
  romExtensions: string[];
  romDirectoryMarkers: string[];
}

export const KNOWN_BINARIES: Record<EmulatorSystem, KnownBinary> = {
  ps1: {
    system: "ps1",
    binary: "duckstation",
    displayName: "DuckStation",
    linuxNames: [
      "duckstation-qt",
      "duckstation-nogui",
      "duckstation",
      "DuckStation",
    ],
    windowsNames: [
      "duckstation-qt-x64-ReleaseLTCG.exe",
      "duckstation-qt.exe",
      "duckstation-nogui.exe",
    ],
    flatpakIds: ["org.duckstation.DuckStation"],
    versionFlags: ["-version"],
    romExtensions: [
      ".cue",
      ".bin",
      ".iso",
      ".chd",
      ".pbp",
      ".img",
      ".sub",
      ".ccd",
      ".mds",
      ".mdf",
      ".ecm",
      ".m3u",
    ],
    romDirectoryMarkers: [],
  },
  ps2: {
    system: "ps2",
    binary: "pcsx2",
    displayName: "PCSX2",
    linuxNames: ["pcsx2-qt", "pcsx2", "PCSX2"],
    windowsNames: ["pcsx2-qt.exe", "pcsx2-qtx64-avx2.exe", "pcsx2.exe"],
    flatpakIds: ["net.pcsx2.PCSX2"],
    versionFlags: ["-version"],
    romExtensions: [
      ".iso",
      ".chd",
      ".cso",
      ".zso",
      ".gz",
      ".nrg",
      ".cue",
      ".bin",
      ".mds",
      ".mdf",
      ".m3u",
    ],
    romDirectoryMarkers: [],
  },
  ps3: {
    system: "ps3",
    binary: "rpcs3",
    displayName: "RPCS3",
    linuxNames: ["rpcs3", "RPCS3"],
    windowsNames: ["rpcs3.exe"],
    flatpakIds: ["net.rpcs3.RPCS3"],
    versionFlags: ["--version"],
    // Only formats RPCS3 launches as a game. Disc dumps are caught via
    // romDirectoryMarkers; license/internal files (.rap/.sfb/.bin/...) excluded.
    romExtensions: [".iso", ".pkg", ".elf", ".self"],
    romDirectoryMarkers: ["PS3_GAME", "ps3_game"],
  },
};
