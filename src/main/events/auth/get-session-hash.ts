import jwt from "jsonwebtoken";

import { userAuthRepository } from "@main/repository";
import { registerEvent } from "../register-event";

const getSessionHash = async (_event: Electron.IpcMainInvokeEvent) => {
  const auth = await userAuthRepository.findOne({ where: { id: 1 } });

  if (!auth) return null;
  const payload = jwt.decode(auth.accessToken) as jwt.JwtPayload;
  return payload.sessionId;
};

registerEvent("getSessionHash", getSessionHash);
