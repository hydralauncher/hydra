import { isMangohudAvailable } from "@main/helpers/is-mangohud-available";
import { registerEvent } from "../register-event";

registerEvent("isMangohudAvailable", async () => {
  return isMangohudAvailable();
});
