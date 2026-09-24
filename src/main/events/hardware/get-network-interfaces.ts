import os from "node:os";

import type { NetworkInterface } from "@types";
import { registerEvent } from "../register-event";

const getNetworkInterfaces = async (): Promise<NetworkInterface[]> => {
  const interfaces = os.networkInterfaces();
  const options: NetworkInterface[] = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses) continue;

    for (const addr of addresses) {
      // Exclude loopback, link-local IPv6, and APIPA addresses
      if (addr.internal) continue;
      if (
        addr.family === "IPv6" &&
        addr.address.toLowerCase().startsWith("fe80")
      )
        continue;
      if (addr.family === "IPv4" && addr.address.startsWith("169.254."))
        continue;

      options.push({
        id: addr.address,
        label: `${name} (${addr.address})`,
        name,
      });
    }
  }

  return options;
};

registerEvent("getNetworkInterfaces", getNetworkInterfaces);
