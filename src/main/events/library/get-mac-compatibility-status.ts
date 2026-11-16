import { getMacCompatibilityStatus } from "@main/services";
import { registerEvent } from "../register-event";

const getMacCompatibilityStatusHandler = async () => {
  return getMacCompatibilityStatus();
};

registerEvent("getMacCompatibilityStatus", getMacCompatibilityStatusHandler);
