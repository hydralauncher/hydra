import { registerEvent } from "../register-event";
import { emulators } from "@main/services";

const getEmulatorConfigs = async () => emulators.getAllEmulatorConfigs();

registerEvent("getEmulatorConfigs", getEmulatorConfigs);
