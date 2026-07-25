import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, TextField } from "@renderer/components";
import { useToast } from "@renderer/hooks";

interface DriveStatus {
  hasOAuthClient: boolean;
  connected: boolean;
  storageQuota?: { limitBytes: number | null; usageBytes: number };
  user?: { email: string; displayName: string };
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function SettingsCloudStorage() {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();

  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const refresh = useCallback(async () => {
    const next = (await window.electron.getDriveStatus()) as DriveStatus;
    setStatus(next);
  }, []);

  useEffect(() => {
    refresh().catch(() => setStatus({ hasOAuthClient: false, connected: false }));
  }, [refresh]);

  const saveClient = useCallback(async () => {
    if (!clientId.trim()) return;
    setSaving(true);
    try {
      await window.electron.setDriveOAuthClient({
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim() || undefined,
      });
      showSuccessToast(t("cloud_storage_client_saved", { defaultValue: "OAuth client saved" }));
      setClientId("");
      setClientSecret("");
      await refresh();
    } catch (err) {
      showErrorToast((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [clientId, clientSecret, refresh, showErrorToast, showSuccessToast, t]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      await window.electron.connectDrive();
      showSuccessToast(t("cloud_storage_connected", { defaultValue: "Google Drive connected" }));
      await refresh();
    } catch (err) {
      showErrorToast((err as Error).message);
    } finally {
      setConnecting(false);
    }
  }, [refresh, showErrorToast, showSuccessToast, t]);

  const disconnect = useCallback(async () => {
    try {
      await window.electron.disconnectDrive();
      showSuccessToast(t("cloud_storage_disconnected", { defaultValue: "Disconnected" }));
      await refresh();
    } catch (err) {
      showErrorToast((err as Error).message);
    }
  }, [refresh, showErrorToast, showSuccessToast, t]);

  return (
    <div className="settings-context-panel__group">
      <p style={{ color: "var(--muted-color)", marginBottom: 16, fontSize: 14 }}>
        {t("cloud_storage_intro", {
          defaultValue:
            "Cloud saves, custom avatars, banners, and custom artwork upload to your own Google Drive. You need a Google OAuth client — see the hybrid setup docs for the 2-minute walkthrough.",
        })}
      </p>

      {!status ? (
        <p>Loading…</p>
      ) : (
        <>
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ marginBottom: 8 }}>
              {t("cloud_storage_oauth_client", { defaultValue: "Google OAuth client" })}
            </h3>
            <p
              style={{
                color: status.hasOAuthClient ? "var(--success-color, #4ade80)" : "var(--muted-color)",
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              {status.hasOAuthClient
                ? t("cloud_storage_client_configured", { defaultValue: "OAuth client configured." })
                : t("cloud_storage_client_missing", {
                    defaultValue: "Paste your client ID below. Optional client secret only needed for Web-type clients.",
                  })}
            </p>
            <div style={{ display: "grid", gap: 8, maxWidth: 600 }}>
              <TextField
                label="Client ID"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder={
                  status.hasOAuthClient
                    ? "Enter a new client ID to replace the stored one"
                    : "1234567890-xxxx.apps.googleusercontent.com"
                }
              />
              <TextField
                label="Client secret (optional)"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                type="password"
                placeholder="Leave blank for Desktop-app clients"
              />
              <div style={{ display: "flex", gap: 8 }}>
                <Button theme="primary" onClick={saveClient} disabled={saving || !clientId.trim()}>
                  {saving ? "Saving…" : t("save", { defaultValue: "Save" })}
                </Button>
              </div>
            </div>
          </div>

          <hr className="settings-context-panel__divider" />

          <div>
            <h3 style={{ marginBottom: 8 }}>
              {t("cloud_storage_connection", { defaultValue: "Connection" })}
            </h3>
            {status.connected ? (
              <div>
                <p style={{ fontSize: 14, marginBottom: 4 }}>
                  {t("cloud_storage_signed_in_as", { defaultValue: "Signed in as" })}{" "}
                  <strong>{status.user?.email ?? "Google account"}</strong>
                </p>
                {status.storageQuota && (
                  <p style={{ color: "var(--muted-color)", fontSize: 13, marginBottom: 12 }}>
                    {formatBytes(status.storageQuota.usageBytes)} used
                    {status.storageQuota.limitBytes
                      ? ` of ${formatBytes(status.storageQuota.limitBytes)}`
                      : " (unlimited)"}
                  </p>
                )}
                <Button theme="outline" onClick={disconnect}>
                  {t("cloud_storage_disconnect", { defaultValue: "Disconnect" })}
                </Button>
              </div>
            ) : (
              <div>
                <p style={{ color: "var(--muted-color)", fontSize: 13, marginBottom: 12 }}>
                  {t("cloud_storage_not_connected", {
                    defaultValue:
                      "Not connected. Clicking Connect opens Google in your browser for consent.",
                  })}
                </p>
                <Button
                  theme="primary"
                  onClick={connect}
                  disabled={!status.hasOAuthClient || connecting}
                >
                  {connecting
                    ? t("cloud_storage_connecting", { defaultValue: "Connecting…" })
                    : t("cloud_storage_connect", { defaultValue: "Connect Google Drive" })}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
