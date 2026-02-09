import { registerEvent } from "../register-event";
import { Umu } from "@main/services";

const getInstalledProtonVersions = async () => {
  return Umu.getInstalledProtonVersions();
};

registerEvent("getInstalledProtonVersions", getInstalledProtonVersions);
