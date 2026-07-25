import { registerEvent } from "../register-event";
import { saveOAuthClient } from "@main/services/drive";

interface SetClientInput {
  clientId: string;
  clientSecret?: string;
}

registerEvent(
  "setDriveOAuthClient",
  async (_event, input: SetClientInput) => {
    if (!input?.clientId || typeof input.clientId !== "string") {
      throw new Error("clientId is required");
    }
    await saveOAuthClient({
      clientId: input.clientId.trim(),
      clientSecret: input.clientSecret?.trim() || undefined,
    });
    return { ok: true };
  }
);
