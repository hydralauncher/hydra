import { registerEvent } from "../register-event";
import { selectEmulatorCloudSaveCard } from "@main/services/cloud-save/emulator-cloud-save";
import type { SetEmulatorCloudSaveCardInput } from "@types";

registerEvent(
  "selectEmulatorCloudSaveCard",
  (_event: Electron.IpcMainInvokeEvent, input: SetEmulatorCloudSaveCardInput) =>
    selectEmulatorCloudSaveCard(input)
);
