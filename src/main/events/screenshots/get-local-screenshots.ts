import { getLocalScreenshots } from "@main/services/screenshots";
import { registerEvent } from "../register-event";

registerEvent("getLocalScreenshots", () => getLocalScreenshots());
