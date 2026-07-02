import os from "node:os";

import type { NetworkInterface } from "@types";
import { registerEvent } from "../register-event";

const getNetworkInterfaces = async (): Promise<NetworkInterface[]> => {
  const interfaces = os.networkInterfaces();

  return Object.entries(interfaces).reduce<NetworkInterface[]>(
    (acc, [name, addresses]) => {
      const external = (addresses ?? []).filter((address) => !address.internal);

      if (external.length === 0) {
        return acc;
      }

      const sorted = external.sort((a, b) => {
        if (a.family === b.family) return 0;
        return a.family === "IPv4" ? -1 : 1;
      });

      acc.push({
        name,
        addresses: sorted.map((address) => address.address),
      });

      return acc;
    },
    []
  );
};

registerEvent("getNetworkInterfaces", getNetworkInterfaces);
