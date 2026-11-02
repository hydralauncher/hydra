import type { SteamIntegrationStatus } from "@types";

interface PendingSteamDisconnect {
  integration: SteamIntegrationStatus;
  promise: Promise<void>;
}

let pendingDisconnect: PendingSteamDisconnect | null = null;

export const getPendingSteamDisconnect = () => pendingDisconnect;

export const runSteamDisconnect = (
  integration: SteamIntegrationStatus,
  disconnect: () => Promise<void>
) => {
  const promise: Promise<void> = disconnect().finally(() => {
    if (pendingDisconnect?.promise === promise) pendingDisconnect = null;
  });

  pendingDisconnect = { integration, promise };

  return promise;
};
