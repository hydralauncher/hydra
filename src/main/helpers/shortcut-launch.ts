import path from "node:path";

import type { GameShop } from "@types";

export const buildRunDeepLink = (shop: GameShop, objectId: string) => {
  const query = new URLSearchParams({
    shop,
    objectId,
  });

  return `hydralauncher://run?${query.toString()}`;
};

const quoteLinuxExecArg = (value: string) => {
  return `"${value.replaceAll('"', String.raw`\"`)}"`;
};

export const getShortcutArguments = (deepLink: string) => {
  const deepLinkArgument =
    process.platform === "linux" ? quoteLinuxExecArg(deepLink) : deepLink;

  if (process.defaultApp && process.argv.length >= 2) {
    const appEntry = path.resolve(process.argv[1]);
    const appEntryArgument =
      process.platform === "linux" ? quoteLinuxExecArg(appEntry) : appEntry;

    return `${appEntryArgument} ${deepLinkArgument}`;
  }

  return deepLinkArgument;
};
