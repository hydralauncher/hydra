import { registerEvent } from "../register-event";
import { isClassicsImporting } from "./classics-import-state";

const getClassicsImportStatus = async () => isClassicsImporting();

registerEvent("getClassicsImportStatus", getClassicsImportStatus);
