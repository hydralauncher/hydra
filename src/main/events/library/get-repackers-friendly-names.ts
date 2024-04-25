import { registerEvent } from "../register-event";
import { stateManager } from "@main/state-manager";

const getRepackersFriendlyNames = async () =>
  stateManager.getValue("repackersFriendlyNames").reduce((prev, next) => {
    return { ...prev, [next.name]: next.friendlyName };
  }, {});

registerEvent(getRepackersFriendlyNames, {
  name: "getRepackersFriendlyNames",
  memoize: true,
});
