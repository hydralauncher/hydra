import type {
  KnownStoreAccount,
  SnapshotVariant,
  StoreUserContext,
} from "@types";

import { toSteamAccount } from "../steam-login-users.js";

export const storeUserContextWithSnapshotAccounts = (
  localContext: StoreUserContext,
  variants: SnapshotVariant[]
): StoreUserContext => {
  const knownSteamIds = new Set(
    localContext.known.flatMap((account) =>
      account.steamId64 ? [account.steamId64] : []
    )
  );
  if (localContext.active?.steamId64)
    knownSteamIds.add(localContext.active.steamId64);
  const remoteAccounts: KnownStoreAccount[] = [];

  for (const variant of variants) {
    if (
      variant.kind !== "steam-account" ||
      knownSteamIds.has(variant.steamId64)
    ) {
      continue;
    }

    const account = toSteamAccount(variant.steamId64, "remote-snapshot");
    if (!account) {
      throw new Error("Invalid Steam account in Cloud Save snapshot");
    }
    knownSteamIds.add(variant.steamId64);
    remoteAccounts.push(account);
  }
  remoteAccounts.sort((left, right) =>
    (left.steamId64 ?? "").localeCompare(right.steamId64 ?? "")
  );

  return {
    ...(localContext.active ? { active: localContext.active } : {}),
    known: [...localContext.known, ...remoteAccounts],
  };
};
