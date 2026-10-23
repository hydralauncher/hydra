import { openScreenshotsFolder } from "@main/services/screenshots";
import { registerEvent } from "../register-event";

registerEvent("openScreenshotsFolder", () => openScreenshotsFolder());
