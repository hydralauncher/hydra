import type { EmulatorBinary, EmulatorSystem } from "@types";

export interface KnownBinary {
  system: EmulatorSystem;
  binary: EmulatorBinary;
  displayName: string;
  linuxNames: string[];
  windowsNames: string[];
  macosBundleNames: string[];
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
    macosBundleNames: ["DuckStation.app"],
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
    macosBundleNames: ["PCSX2.app"],
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
    macosBundleNames: ["RPCS3.app"],
    flatpakIds: ["net.rpcs3.RPCS3"],
    versionFlags: ["--version"],
    // Only formats RPCS3 launches as a game. Disc dumps are caught via
    // romDirectoryMarkers; license/internal files (.rap/.sfb/.bin/...) excluded.
    romExtensions: [".iso", ".pkg", ".elf", ".self"],
    romDirectoryMarkers: ["PS3_GAME", "ps3_game"],
  },
  psp: {
    system: "psp",
    binary: "ppsspp",
    displayName: "PPSSPP",
    linuxNames: ["PPSSPPSDL", "ppsspp"],
    windowsNames: ["PPSSPPWindows64.exe", "PPSSPPWindowsARM64.exe"],
    macosBundleNames: ["PPSSPP.app", "PPSSPPSDL.app"],
    flatpakIds: ["org.ppsspp.PPSSPP"],
    versionFlags: ["--version"],
    romExtensions: [".iso", ".cso", ".chd", ".pbp"],
    romDirectoryMarkers: ["PSP_GAME", "psp_game"],
  },
  dolphin: {
    system: "dolphin",
    binary: "dolphin",
    displayName: "Dolphin",
    linuxNames: ["dolphin-emu", "dolphin-emu-qt2", "dolphin"],
    windowsNames: ["Dolphin.exe"],
    macosBundleNames: ["Dolphin.app"],
    flatpakIds: ["org.DolphinEmu.dolphin-emu"],
    versionFlags: ["--version"],
    romExtensions: [
      ".iso",
      ".gcm",
      ".bin",
      ".rvz",
      ".wia",
      ".gcz",
      ".ciso",
      ".tgc",
      ".wbfs",
      ".wad",
    ],
    romDirectoryMarkers: [],
  },
};

export const EMULATOR_BINARIES: readonly EmulatorBinary[] = Array.from(
  new Set(Object.values(KNOWN_BINARIES).map((entry) => entry.binary))
);

export const systemsForBinary = (binary: EmulatorBinary): EmulatorSystem[] =>
  Object.values(KNOWN_BINARIES)
    .filter((entry) => entry.binary === binary)
    .map((entry) => entry.system);

export const isKnownEmulatorBinary = (
  value: unknown
): value is EmulatorBinary =>
  typeof value === "string" &&
  (EMULATOR_BINARIES as readonly string[]).includes(value);
