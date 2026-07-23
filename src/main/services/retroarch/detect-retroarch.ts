import {
  detectEmulator,
  type DetectableBinary,
  type DetectionResult,
} from "../emulators/detect-emulator";
import { getEmulatorVersion } from "../emulators/get-emulator-version";

export const RETROARCH_DETECTABLE: DetectableBinary = {
  binary: "retroarch",
  displayName: "RetroArch",
  linuxNames: ["retroarch", "RetroArch"],
  windowsNames: ["retroarch.exe"],
  flatpakIds: ["org.libretro.RetroArch"],
  versionFlags: ["--version"],
};

export const detectRetroArch = (options?: {
  resolveVersion?: boolean;
}): DetectionResult | null => detectEmulator(RETROARCH_DETECTABLE, options);

export const getRetroArchVersion = (executablePath: string): string | null =>
  getEmulatorVersion(executablePath, RETROARCH_DETECTABLE);
