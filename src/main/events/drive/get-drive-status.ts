import { registerEvent } from "../register-event";
import { about, getOAuthClient, isDriveConnected } from "@main/services/drive";

export interface DriveStatus {
  hasOAuthClient: boolean;
  connected: boolean;
  storageQuota?: { limitBytes: number | null; usageBytes: number };
  user?: { email: string; displayName: string };
}

registerEvent("getDriveStatus", async (): Promise<DriveStatus> => {
  const [client, connected] = await Promise.all([
    getOAuthClient(),
    isDriveConnected(),
  ]);
  if (!connected) {
    return { hasOAuthClient: Boolean(client?.clientId), connected: false };
  }
  const info = await about();
  return {
    hasOAuthClient: Boolean(client?.clientId),
    connected: true,
    storageQuota: info?.storageQuota
      ? {
          limitBytes: info.storageQuota.limit ? Number(info.storageQuota.limit) : null,
          usageBytes: Number(info.storageQuota.usage ?? 0),
        }
      : undefined,
    user: info?.user
      ? { email: info.user.emailAddress, displayName: info.user.displayName }
      : undefined,
  };
});
