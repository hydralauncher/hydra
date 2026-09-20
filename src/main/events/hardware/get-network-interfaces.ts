import os from "node:os";

import type { NetworkInterface } from "@types";
import { registerEvent } from "../register-event";

const getNetworkInterfaces = async (): Promise<NetworkInterface[]> => {
  const interfaces = os.networkInterfaces();
  const options: NetworkInterface[] = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses) continue;

    for (const addr of addresses) {
      // Exclude loopback and link-local IPv6
      if (addr.internal) continue;
      if (
        addr.family === "IPv6" &&
        addr.address.toLowerCase().startsWith("fe80")
      )
        continue;

      options.push({
        id: addr.address,
        label: `${name} (${addr.address})`,
      });
    }
  }

  return options;
};

registerEvent("getNetworkInterfaces", getNetworkInterfaces);
