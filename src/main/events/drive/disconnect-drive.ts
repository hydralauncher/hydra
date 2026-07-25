import { registerEvent } from "../register-event";
import { disconnectDrive } from "@main/services/drive";

registerEvent("disconnectDrive", async () => {
  await disconnectDrive();
  return { ok: true };
});
