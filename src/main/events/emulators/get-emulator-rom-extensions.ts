import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

const getEmulatorRomExtensions = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem
): Promise<string[]> => {
  const binary = emulators.KNOWN_BINARIES[system];
  return binary.romExtensions.map((ext) =>
    ext.startsWith(".") ? ext.slice(1) : ext
  );
};

registerEvent("getEmulatorRomExtensions", getEmulatorRomExtensions);
