import { randomUUID } from "node:crypto";

import { registerEvent } from "../register-event";

const appSessionId = randomUUID();

const getAppSessionId = async () => appSessionId;

registerEvent("getAppSessionId", getAppSessionId);
