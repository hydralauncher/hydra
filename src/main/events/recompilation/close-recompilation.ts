import { registerEvent } from "../register-event";
import { parseRecompilationRef } from "./recompilation-paths";

registerEvent(
  "closeRecompilation",
  async (_event: Electron.IpcMainInvokeEvent, rawRef: unknown) => {
    const ref = parseRecompilationRef(rawRef);
    if (!ref) return { ok: false, reason: "invalid_port" };

    // Only loaded once a port has been played, like the play handler does.
    const { closeRecompilation } = await import("./recompilation-session");
    return closeRecompilation(ref)
      ? { ok: true }
      : { ok: false, reason: "not_running" };
  }
);
