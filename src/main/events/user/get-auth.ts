import { db, levelKeys } from "@main/level";
import type { Auth } from "@types";

import { registerEvent } from "../register-event";

const getAuth = async (_event: Electron.IpcMainInvokeEvent) =>
  db.get<string, Auth>(levelKeys.auth, {
    valueEncoding: "json",
  });

registerEvent("getAuth", getAuth);
