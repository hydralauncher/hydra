import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, ClassicsSpinner, Modal } from "@renderer/components";
import { useDate, useToast, useUserDetails } from "@renderer/hooks";
import { LinkExternalIcon, PersonIcon, SyncIcon } from "@primer/octicons-react";
import {
  AuthPage,
  isSteamReconnectRequired,
  shouldAutoStartSteamSync,
} from "@shared";
import { logger } from "@renderer/logger";
import type {
  SteamIntegrationStatus,
  SteamSyncFinishedPayload,
  SteamSyncState,
} from "@types";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import { SettingsIntegrationCard } from "./settings-integration-card";

import "./settings-steam.scss";

const INTEGRATION_ENDPOINT = "/profile/integrations/steam";

const DISCONNECTED_STATUS: SteamIntegrationStatus = {
  connected: false,
  snapshotPreserved: false,
};

const STATUS_ICON_SIZE = 14;
const AVATAR_FALLBACK_ICON_SIZE = 28;

const getLatestSyncRunStatus = (status: SteamIntegrationStatus) =>
  status.connected || status.snapshotPreserved
    ? (status.latestSyncRun?.status ?? null)
    : null;

const isLastAuthMethodError = (message?: string) => {
  if (!message) return false;

  const lower = message.toLowerCase();

  return (
    lower.includes("last-authentication") ||
    lower.includes("last_authentication") ||
    lower.includes("last-auth") ||
    lower.includes("last authentication")
  );
};

const isSteamAlreadyLinkedError = (message?: string) =>
  Boolean(message?.toLowerCase().includes("already-linked"));

export function SettingsSteam() {
  const { userDetails } = useUserDetails();
  const { showSuccessToast, showErrorToast } = useToast();
  const { formatDateTime } = useDate();
  const { t, i18n } = useTranslation("settings");

  const [isLoading, setIsLoading] = useState(() => Boolean(userDetails));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [integration, setIntegration] =
    useState<SteamIntegrationStatus>(DISCONNECTED_STATUS);
  const [avatarError, setAvatarError] = useState(false);
  const [showDeleteDataModal, setShowDeleteDataModal] = useState(false);
  const [syncState, setSyncState] = useState<SteamSyncState>({
    status: "idle",
  });
  const didAutoStart = useRef(false);
  const wasConnectedRef = useRef(false);

  const steamAccount =
    integration.connected || integration.snapshotPreserved ? integration : null;
  const isSyncing =
    syncState.status === "running" || syncState.status === "cancelling";
  const needsReconnect =
    integration.connected &&
    syncState.status === "idle" &&
    syncState.requiresReconnect === true;

  useEffect(() => {
    setAvatarError(false);
  }, [steamAccount?.username, steamAccount?.avatarUrl]);

  const getSteamErrorMessage = useCallback(
    (
      error: unknown,
      fallbackKey: "steam_connect_error" | "steam_disconnect_error"
    ) => {
      const message = error instanceof Error ? error.message : undefined;

      if (isLastAuthMethodError(message)) {
        return t("steam_last_auth_method");
      }

      if (isSteamAlreadyLinkedError(message)) {
        return t("steam_account_already_linked");
      }

      return t(fallbackKey);
    },
    [t]
  );

  const getSteamSyncErrorMessage = useCallback(
    (message?: string) => {
      if (message === "steam-sync-in-progress") {
        return t("steam_sync_in_progress");
      }

      if (
        message === "steam-profile-private" ||
        message === "profile/steam-profile-private"
      ) {
        return t("steam_error_private_profile");
      }

      if (
        message === "steam-upstream-unavailable" ||
        message === "profile/steam-upstream-unavailable"
      ) {
        return t("steam_error_steam_unavailable");
      }

      if (
        message === "steam-rate-limited" ||
        message === "profile/steam-rate-limited"
      ) {
        return t("steam_error_rate_limited");
      }

      if (message === "steam-session-required") {
        return t("steam_error_session_required");
      }

      if (message === "steam-account-mismatch") {
        return t("steam_error_account_mismatch");
      }

      return t("steam_sync_failed");
    },
    [t]
  );

  const tryAutoStart = useCallback(
    async (status: SteamIntegrationStatus) => {
      if (didAutoStart.current) {
        return;
      }

      const localState = await globalThis.window.electron.getSteamSyncState();
      setSyncState(localState);

      if (
        !shouldAutoStartSteamSync({
          connected: status.connected,
          lastSyncedAt: status.connected ? status.lastSyncedAt : null,
          latestSyncRunStatus: getLatestSyncRunStatus(status),
          localOrchestratorIdle: localState.status === "idle",
          requiresReconnect:
            localState.status === "idle" &&
            localState.requiresReconnect === true,
        })
      ) {
        return;
      }

      didAutoStart.current = true;

      try {
        const state = await globalThis.window.electron.startSteamSync();
        setSyncState(state);
      } catch (error) {
        const message = error instanceof Error ? error.message : undefined;
        if (isSteamReconnectRequired(message)) {
          setSyncState({ status: "idle", requiresReconnect: true });
        }
        showErrorToast(getSteamSyncErrorMessage(message));
      }
    },
    [getSteamSyncErrorMessage, showErrorToast]
  );

  const refreshStatus = useCallback(
    async (options?: {
      silent?: boolean;
      toastOnConnect?: boolean;
      fromMount?: boolean;
      fromFocus?: boolean;
    }) => {
      if (!userDetails) {
        setIntegration(DISCONNECTED_STATUS);
        setIsLoading(false);
        didAutoStart.current = false;
        wasConnectedRef.current = false;
        return;
      }

      if (!options?.silent) {
        setIsLoading(true);
      }

      try {
        const status =
          await globalThis.window.electron.hydraApi.get<SteamIntegrationStatus>(
            INTEGRATION_ENDPOINT
          );

        setIntegration(status);

        const latestSyncRunStatus = getLatestSyncRunStatus(status);

        await globalThis.window.electron.reconcileSteamSyncRun(
          latestSyncRunStatus
        );

        if (!status.connected) {
          didAutoStart.current = false;
        }

        if (options?.toastOnConnect && status.connected) {
          showSuccessToast(t("steam_account_linked"));
        }

        const becameConnected = !wasConnectedRef.current && status.connected;
        const shouldAttemptAutoStart =
          Boolean(options?.fromMount) ||
          Boolean(options?.toastOnConnect) ||
          (Boolean(options?.fromFocus) && becameConnected);

        wasConnectedRef.current = status.connected;

        if (shouldAttemptAutoStart) {
          void tryAutoStart(status);
        }
      } catch (error) {
        logger.error(error);

        if (!options?.silent) {
          setIntegration(DISCONNECTED_STATUS);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [showSuccessToast, t, tryAutoStart, userDetails]
  );

  useEffect(() => {
    void refreshStatus({ fromMount: true });
  }, [refreshStatus]);

  useEffect(() => {
    const unsubscribe = globalThis.window.electron.onSteamConnected(() => {
      didAutoStart.current = false;
      setSyncState({ status: "idle" });
      void refreshStatus({ silent: true, toastOnConnect: true });
    });

    return unsubscribe;
  }, [refreshStatus]);

  useEffect(() => {
    const unsubscribe = globalThis.window.electron.onSteamConnectError(
      (code) => {
        showErrorToast(
          code === "already-linked"
            ? t("steam_account_already_linked")
            : t("steam_connect_error")
        );
      }
    );

    return unsubscribe;
  }, [showErrorToast, t]);

  useEffect(() => {
    const onFocus = () => {
      void refreshStatus({ silent: true, fromFocus: true });
    };

    globalThis.window.addEventListener("focus", onFocus);

    return () => {
      globalThis.window.removeEventListener("focus", onFocus);
    };
  }, [refreshStatus]);

  useEffect(() => {
    void globalThis.window.electron.getSteamSyncState().then((state) => {
      setSyncState((current) => (current.status === "idle" ? state : current));
    });
  }, []);

  useEffect(() => {
    const unsubscribeProgress = globalThis.window.electron.onSteamSyncProgress(
      (state) => {
        setSyncState(state);
      }
    );
    const unsubscribeFinished = globalThis.window.electron.onSteamSyncFinished(
      (payload: SteamSyncFinishedPayload) => {
        setSyncState(
          !payload.ok && isSteamReconnectRequired(payload.message)
            ? { status: "idle", requiresReconnect: true }
            : { status: "idle" }
        );

        if (payload.ok) {
          setIntegration(payload.status);
          if (payload.origin === "manual") {
            showSuccessToast(t("steam_sync_success"));
          }
          return;
        }

        if (
          payload.origin === "manual" &&
          payload.message !== "steam-sync-aborted"
        ) {
          showErrorToast(getSteamSyncErrorMessage(payload.message));
        }

        void refreshStatus({ silent: true });
      }
    );

    return () => {
      unsubscribeProgress();
      unsubscribeFinished();
    };
  }, [
    getSteamSyncErrorMessage,
    refreshStatus,
    showErrorToast,
    showSuccessToast,
    t,
  ]);

  const handleConnect = async () => {
    setIsSubmitting(true);

    try {
      await globalThis.window.electron.startSteamOAuth(i18n.language);
    } catch (error) {
      showErrorToast(getSteamErrorMessage(error, "steam_connect_error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSync = async () => {
    try {
      const state = await globalThis.window.electron.startSteamSync();
      setSyncState(state);
    } catch (error) {
      const message = error instanceof Error ? error.message : undefined;
      if (isSteamReconnectRequired(message)) {
        setSyncState({ status: "idle", requiresReconnect: true });
      }
      showErrorToast(getSteamSyncErrorMessage(message));
    }
  };

  const handleCancelSync = async () => {
    await globalThis.window.electron.cancelSteamSync();
  };

  const handleDisconnect = async () => {
    setIsSubmitting(true);
    setIsDisconnecting(true);

    try {
      await globalThis.window.electron.disconnectSteam(true);

      showSuccessToast(t("steam_account_unlinked"));
      setShowDeleteDataModal(false);
      await refreshStatus({ silent: true });
    } catch (error) {
      showErrorToast(getSteamErrorMessage(error, "steam_disconnect_error"));
    } finally {
      setIsDisconnecting(false);
      setIsSubmitting(false);
    }
  };

  const renderBody = () => {
    if (!userDetails) {
      return <p>{t("steam_sign_in_required")}</p>;
    }

    if (isLoading) {
      return <p>{t("steam_loading")}</p>;
    }

    if (steamAccount) {
      const hasProgress =
        syncState.status === "running" && syncState.gamesFound > 0;
      const progress = hasProgress
        ? Math.min(100, (syncState.gamesProcessed / syncState.gamesFound) * 100)
        : 0;

      return (
        <>
          <div className="settings-integration-card__profile">
            <div className="settings-integration-card__avatar">
              {steamAccount.avatarUrl && !avatarError ? (
                <img
                  src={steamAccount.avatarUrl}
                  alt={steamAccount.username}
                  onError={() => setAvatarError(true)}
                />
              ) : (
                <PersonIcon size={AVATAR_FALLBACK_ICON_SIZE} />
              )}
            </div>

            <div className="settings-integration-card__account">
              <span className="settings-integration-card__username">
                {steamAccount.username}
              </span>
              {integration.connected ? (
                <span className="settings-integration-card__meta">
                  {steamAccount.lastSyncedAt
                    ? t("steam_last_synced", {
                        date: formatDateTime(steamAccount.lastSyncedAt),
                      })
                    : t("steam_never_synced")}
                </span>
              ) : null}
            </div>
          </div>

          {isDisconnecting ? (
            <p className="settings-integration-card__message" role="status">
              {integration.connected
                ? t("steam_disconnecting")
                : t("steam_removing_imported_data")}
            </p>
          ) : integration.connected && needsReconnect ? (
            <p className="settings-integration-card__message">
              {t("steam_error_session_required")}
            </p>
          ) : integration.connected && isSyncing ? (
            <div className="settings-integration-card__progress" role="status">
              <div className="settings-integration-card__progress-header">
                <span>{t("steam_syncing")}</span>
                {hasProgress && syncState.status === "running" ? (
                  <span className="settings-integration-card__progress-count">
                    {t("steam_sync_progress", {
                      processed: syncState.gamesProcessed,
                      found: syncState.gamesFound,
                    })}
                  </span>
                ) : null}
              </div>
              <div className="settings-integration-card__progress-track">
                <div
                  className={`settings-integration-card__progress-fill ${
                    hasProgress
                      ? ""
                      : "settings-integration-card__progress-fill--indeterminate"
                  }`}
                  style={hasProgress ? { width: `${progress}%` } : undefined}
                />
              </div>
            </div>
          ) : null}
        </>
      );
    }

    return (
      <p className="settings-integration-card__description">
        {t("steam_integration_description")}
      </p>
    );
  };

  const renderActions = () => {
    if (!userDetails) {
      return (
        <Button
          onClick={() =>
            globalThis.window.electron.openAuthWindow(AuthPage.SignIn)
          }
        >
          {t("steam_sign_in")}
        </Button>
      );
    }

    if (isLoading) return null;

    if (!steamAccount) {
      return (
        <Button onClick={handleConnect} disabled={isSubmitting}>
          <LinkExternalIcon size={STATUS_ICON_SIZE} />
          {t("steam_connect")}
        </Button>
      );
    }

    if (integration.snapshotPreserved) {
      return (
        <>
          <Button onClick={handleConnect} disabled={isSubmitting || isSyncing}>
            <LinkExternalIcon size={STATUS_ICON_SIZE} />
            {t("steam_reconnect")}
          </Button>
          <Button
            theme="danger"
            onClick={() => setShowDeleteDataModal(true)}
            disabled={isSubmitting || isSyncing}
          >
            {t("steam_remove_imported_data")}
          </Button>
        </>
      );
    }

    return (
      <>
        {needsReconnect ? (
          <Button onClick={handleConnect} disabled={isSubmitting}>
            <LinkExternalIcon size={STATUS_ICON_SIZE} />
            {t("steam_reconnect")}
          </Button>
        ) : isSyncing ? (
          <Button
            theme="outline"
            onClick={handleCancelSync}
            disabled={syncState.status === "cancelling"}
          >
            {t("steam_sync_cancel")}
          </Button>
        ) : (
          <Button theme="outline" onClick={handleSync} disabled={isSubmitting}>
            <SyncIcon size={STATUS_ICON_SIZE} />
            {t("steam_sync")}
          </Button>
        )}
        <Button
          theme="danger"
          onClick={() => setShowDeleteDataModal(true)}
          disabled={isSubmitting || isSyncing}
        >
          {t("steam_disconnect")}
        </Button>
      </>
    );
  };

  const status = needsReconnect
    ? t("steam_status_reconnect_required")
    : integration.connected
      ? t("steam_status_connected")
      : integration.snapshotPreserved
        ? t("steam_status_snapshot_preserved")
        : t("integration_status_not_connected");

  const statusTone =
    needsReconnect || integration.snapshotPreserved
      ? "warning"
      : integration.connected
        ? "success"
        : "neutral";

  return (
    <>
      <SettingsIntegrationCard
        title={t("steam")}
        logo={<SteamLogo />}
        status={status}
        statusTone={statusTone}
        actions={renderActions()}
      >
        {renderBody()}
      </SettingsIntegrationCard>

      <Modal
        visible={showDeleteDataModal}
        onClose={() => setShowDeleteDataModal(false)}
        clickOutsideToClose={!isDisconnecting}
        title={
          integration.connected
            ? t("steam_delete_confirm_title")
            : t("steam_remove_imported_data")
        }
        description={t("steam_delete_confirm_description")}
      >
        <div className="settings-steam__modal-actions">
          <Button
            theme="outline"
            onClick={() => setShowDeleteDataModal(false)}
            disabled={isSubmitting}
          >
            {t("cancel")}
          </Button>
          <Button
            theme="danger"
            onClick={() => void handleDisconnect()}
            disabled={isSubmitting}
          >
            {isDisconnecting ? <ClassicsSpinner size={14} /> : null}
            {isDisconnecting
              ? integration.connected
                ? t("steam_disconnecting")
                : t("steam_removing_imported_data")
              : integration.connected
                ? t("steam_delete_confirm_button")
                : t("steam_remove_imported_data")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
