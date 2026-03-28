import { registerEvent } from "../register-event";
import { PremiumizeClient } from "@main/services/download/premiumize";

const authenticatePremiumize = async (
  _event: Electron.IpcMainInvokeEvent,
  apiToken: string
) => {
  PremiumizeClient.authorize(apiToken);

  const user = await PremiumizeClient.getUser();
  return user;
};

registerEvent("authenticatePremiumize", authenticatePremiumize);
