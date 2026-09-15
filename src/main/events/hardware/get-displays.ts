import { DisplayManager } from "@main/services";
import { registerEvent } from "../register-event";

const getDisplays = async () => DisplayManager.getDisplays();

registerEvent("getDisplays", getDisplays);
