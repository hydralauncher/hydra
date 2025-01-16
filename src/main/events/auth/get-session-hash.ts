import jwt from "jsonwebtoken";

import { registerEvent } from "../register-event";
import { db } from "@main/level";
import type { Auth } from "@types";
import { levelKeys } from "@main/level";
import { Crypto } from "@main/services";

const getSessionHash = async (_event: Electron.IpcMainInvokeEvent) => {
  const auth = await db.get<string, Auth>(levelKeys.auth, {
    valueEncoding: "json",
  });

  if (!auth) return null;
  const payload = jwt.decode(
    Crypto.decrypt(auth.accessToken)
  ) as jwt.JwtPayload;

  if (!payload) return null;

  return payload.sessionId;
};

registerEvent("getSessionHash", getSessionHash);
