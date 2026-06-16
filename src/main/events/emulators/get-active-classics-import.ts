import { registerEvent } from "../register-event";
import { getActiveClassicsImport } from "./classics-import-state";

const getActiveClassicsImportEvent = async () => getActiveClassicsImport();

registerEvent("getActiveClassicsImport", getActiveClassicsImportEvent);
