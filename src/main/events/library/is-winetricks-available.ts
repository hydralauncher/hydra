import { isWinetricksAvailable } from "@main/helpers/is-winetricks-available";
import { registerEvent } from "../register-event";

registerEvent("isWinetricksAvailable", async () => {
  return isWinetricksAvailable();
});
