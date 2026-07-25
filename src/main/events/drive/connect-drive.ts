import { registerEvent } from "../register-event";
import { connectDrive } from "@main/services/drive";

const handler = async () => {
  await connectDrive();
  return { ok: true };
};

registerEvent("connectDrive", handler);
