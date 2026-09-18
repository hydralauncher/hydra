import { registerEvent } from "../register-event";
import { StreamSidecar } from "@main/services/stream-sidecar";

registerEvent("submitStreamPairingPin", async (_event, pin: string) => {
  return StreamSidecar.request<string>("submitPairingPin", { pin });
});
