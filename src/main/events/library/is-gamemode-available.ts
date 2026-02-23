import { isGamemodeAvailable } from "@main/helpers/is-gamemode-available";
import { registerEvent } from "../register-event";

registerEvent("isGamemodeAvailable", async () => {
  return isGamemodeAvailable();
});
