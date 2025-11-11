import { registerEvent } from "../register-event";
import { ProxyManager } from "@main/services";

const getSystemProxy = async () => {
  return ProxyManager.getSystemProxy();
};

registerEvent("getSystemProxy", getSystemProxy);
