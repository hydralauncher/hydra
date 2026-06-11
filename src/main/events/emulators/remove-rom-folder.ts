import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

const removeRomFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  folderId: string
) => {
  return emulators.updateEmulatorConfig(system, (current) =>
    emulators.recomputeTotals({
      ...current,
      romFolders: current.romFolders.filter((f) => f.id !== folderId),
    })
  );
};

registerEvent("removeRomFolder", removeRomFolder);
