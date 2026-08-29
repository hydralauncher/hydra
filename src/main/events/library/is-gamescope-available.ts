import { isGamescopeAvailable } from "@main/helpers/is-gamescope-available";
import { registerEvent } from "../register-event";

registerEvent("isGamescopeAvailable", async () => {
  return isGamescopeAvailable();
});
