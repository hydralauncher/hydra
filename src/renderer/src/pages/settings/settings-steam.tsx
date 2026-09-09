import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, CheckboxField, Modal } from "@renderer/components";
import { useDate, useToast, useUserDetails } from "@renderer/hooks";
import {
  CheckCircleFillIcon,
  ChevronRightIcon,
  LinkExternalIcon,
  PersonIcon,
  SyncIcon,
} from "@primer/octicons-react";
import { AuthPage } from "@shared";
import { logger } from "@renderer/logger";
import type {
  SteamIntegrationStatus,
  SteamSyncFinishedPayload,
  SteamSyncState,
} from "@types";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";

import {
  readStoredSectionCollapsed,
  storeSectionCollapsed,
} from "./collapsed-sections";

import "./settings-debrid.scss";
import "./settings-steam.scss";

const INTEGRATION_ENDPOINT = "/profile/integrations/steam";

const DISCONNECTED_STATUS: SteamIntegrationStatus = {
  connected: false,
  snapshotPreserved: false,
};

const STATUS_ICON_SIZE = 14;
const CHEVRON_ICON_SIZE = 16;
const AVATAR_FALLBACK_ICON_SIZE = 28;

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

export function SettingsSteam() {
  const { userDetails } = useUserDetails();
  const { showSuccessToast, showErrorToast } = useToast();
  const { formatDateTime } = useDate();
  const { t, i18n } = useTranslation("settings");

  const [isLoading, setIsLoading] = useState(() => Boolean(userDetails));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [integration, setIntegration] =
    useState<SteamIntegrationStatus>(DISCONNECTED_STATUS);
  const [avatarError, setAvatarError] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [showDeleteDataModal, setShowDeleteDataModal] = useState(false);
  const [deleteImportedData, setDeleteImportedData] = useState(true);
  const [syncState, setSyncState] = useState<SteamSyncState>({
    status: "idle",
  });
  const [isCollapsed, setIsCollapsed] = useState(() =>
    readStoredSectionCollapsed("steam", !userDetails)
  );

  const steamAccount =
    integration.connected || integration.snapshotPreserved ? integration : null;
  const isSyncing =
    syncState.status === "running" || syncState.status === "cancelling";

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

      return t("steam_sync_failed");
    },
    [t]
  );

  const refreshStatus = useCallback(
    async (options?: { silent?: boolean; toastOnConnect?: boolean }) => {
      if (!userDetails) {
        setIntegration(DISCONNECTED_STATUS);
        setIsLoading(false);
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

        if (options?.toastOnConnect && status.connected) {
          showSuccessToast(t("steam_account_linked"));
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
    [showSuccessToast, t, userDetails]
  );

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    const unsubscribe = globalThis.window.electron.onSteamConnected(() => {
      void refreshStatus({ silent: true, toastOnConnect: true });
    });

    return unsubscribe;
  }, [refreshStatus]);

  useEffect(() => {
    const onFocus = () => {
      void refreshStatus({ silent: true });
    };

    globalThis.window.addEventListener("focus", onFocus);

    return () => {
      globalThis.window.removeEventListener("focus", onFocus);
    };
  }, [refreshStatus]);

  useEffect(() => {
    void globalThis.window.electron.getSteamSyncState().then(setSyncState);
  }, []);

  useEffect(() => {
    const unsubscribeProgress = globalThis.window.electron.onSteamSyncProgress(
      (state) => {
        setSyncState(state);
      }
    );
    const unsubscribeFinished = globalThis.window.electron.onSteamSyncFinished(
      (payload: SteamSyncFinishedPayload) => {
        setSyncState({ status: "idle" });

        if (payload.ok) {
          setIntegration(payload.status);
          showSuccessToast(t("steam_sync_success"));
          return;
        }

        if (payload.message !== "steam-sync-aborted") {
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
      showSuccessToast(t("steam_connect_opened"));
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
      showErrorToast(getSteamSyncErrorMessage(message));
    }
  };

  const handleCancelSync = async () => {
    await globalThis.window.electron.cancelSteamSync();
  };

  const closeDisconnectModal = () => {
    setShowDisconnectModal(false);
    setDeleteImportedData(true);
  };

  const handleConfirmDisconnect = () => {
    if (deleteImportedData) {
      setShowDisconnectModal(false);
      setShowDeleteDataModal(true);
      return;
    }

    void handleDisconnect(false);
  };

  const handleDisconnect = async (shouldDeleteImportedData: boolean) => {
    setShowDisconnectModal(false);
    setShowDeleteDataModal(false);
    setDeleteImportedData(true);
    setIsSubmitting(true);

    try {
      await globalThis.window.electron.disconnectSteam(
        shouldDeleteImportedData
      );

      showSuccessToast(t("steam_account_unlinked"));
      await refreshStatus({ silent: true });
    } catch (error) {
      showErrorToast(getSteamErrorMessage(error, "steam_disconnect_error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleCollapsed = () => {
    const nextCollapsed = !isCollapsed;

    storeSectionCollapsed("steam", nextCollapsed);
    setIsCollapsed(nextCollapsed);
  };

  const renderBody = () => {
    if (!userDetails) {
      return (
        <div className="settings-steam__description-container">
          <p className="settings-steam__description">
            {t("steam_sign_in_required")}
          </p>
          <Button
            onClick={() =>
              globalThis.window.electron.openAuthWindow(AuthPage.SignIn)
            }
          >
            {t("steam_sign_in")}
          </Button>
        </div>
      );
    }

    if (isLoading) {
      return (
        <p className="settings-steam__description">{t("steam_loading")}</p>
      );
    }

    if (steamAccount) {
      return (
        <div className="settings-steam__connected-container">
          <div className="settings-steam__connected">
            <div className="settings-steam__profile">
              <div className="settings-steam__avatar">
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

              <div className="settings-steam__account">
                <span className="settings-steam__username">
                  {steamAccount.username}
                </span>
                <span
                  className={`settings-steam__status ${
                    integration.snapshotPreserved
                      ? "settings-steam__status--preserved"
                      : ""
                  }`}
                >
                  {integration.connected ? (
                    <CheckCircleFillIcon size={STATUS_ICON_SIZE} />
                  ) : null}
                  {integration.connected
                    ? t("steam_status_connected")
                    : t("steam_status_snapshot_preserved")}
                </span>
                {integration.connected ? (
                  <span className="settings-steam__last-synced">
                    {steamAccount.lastSyncedAt
                      ? t("steam_last_synced", {
                          date: formatDateTime(steamAccount.lastSyncedAt),
                        })
                      : t("steam_never_synced")}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="settings-steam__actions">
              {integration.snapshotPreserved ? (
                <>
                  <Button
                    theme="outline"
                    onClick={handleConnect}
                    disabled={isSubmitting || isSyncing}
                  >
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
              ) : (
                <>
                  {isSyncing ? (
                    <Button
                      theme="outline"
                      onClick={handleCancelSync}
                      disabled={syncState.status === "cancelling"}
                    >
                      {t("steam_sync_cancel")}
                    </Button>
                  ) : (
                    <Button
                      theme="outline"
                      onClick={handleSync}
                      disabled={isSubmitting}
                    >
                      <SyncIcon size={STATUS_ICON_SIZE} />
                      {t("steam_sync")}
                    </Button>
                  )}
                  <Button
                    theme="danger"
                    onClick={() => {
                      setDeleteImportedData(true);
                      setShowDisconnectModal(true);
                    }}
                    disabled={isSubmitting || isSyncing}
                  >
                    {t("steam_disconnect")}
                  </Button>
                </>
              )}
            </div>
          </div>
          {integration.connected && isSyncing ? (
            <p className="settings-steam__sync-progress">
              {t("steam_syncing")}
              {syncState.status === "running" &&
              syncState.phase === "achievements" &&
              syncState.gamesFound > 0
                ? ` ${t("steam_sync_progress", {
                    processed: syncState.gamesProcessed,
                    found: syncState.gamesFound,
                  })}`
                : null}
            </p>
          ) : null}
        </div>
      );
    }

    return (
      <div className="settings-steam__description-container">
        <p className="settings-steam__description">
          {t("steam_integration_description")}
        </p>
        <Button
          className="settings-steam__submit-button"
          onClick={handleConnect}
          disabled={isSubmitting}
        >
          <LinkExternalIcon size={STATUS_ICON_SIZE} />
          {t("steam_connect")}
        </Button>
      </div>
    );
  };

  return (
    <>
      <div
        className={`settings-debrid__section ${
          isCollapsed ? "" : "settings-debrid__section--expanded"
        }`}
      >
        <div className="settings-debrid__section-header">
          <button
            type="button"
            className="settings-debrid__collapse-button"
            onClick={toggleCollapsed}
            aria-label={
              isCollapsed
                ? t("expand_debrid_section", { provider: t("steam") })
                : t("collapse_debrid_section", { provider: t("steam") })
            }
          >
            <span
              className={`settings-debrid__collapse-icon ${
                isCollapsed ? "" : "settings-debrid__collapse-icon--expanded"
              }`}
            >
              <ChevronRightIcon size={CHEVRON_ICON_SIZE} />
            </span>
          </button>
          <h3 className="settings-debrid__section-title">{t("steam")}</h3>
          <SteamLogo className="settings-steam__title-logo" />
          {integration.connected ? (
            <CheckCircleFillIcon
              size={CHEVRON_ICON_SIZE}
              className="settings-debrid__check-icon"
            />
          ) : null}
        </div>

        {!isCollapsed && renderBody()}
      </div>

      <Modal
        visible={showDisconnectModal}
        onClose={closeDisconnectModal}
        title={t("steam_disconnect_title")}
      >
        <div className="settings-steam__modal">
          <p className="settings-steam__modal-note">
            {t("steam_disconnect_description")}
          </p>

          <CheckboxField
            label={t("steam_delete_on_disconnect")}
            checked={deleteImportedData}
            onChange={() => setDeleteImportedData((prev) => !prev)}
          />

          <div className="settings-steam__modal-actions">
            <Button
              theme="outline"
              onClick={closeDisconnectModal}
              disabled={isSubmitting}
            >
              {t("cancel")}
            </Button>
            <Button
              theme="danger"
              onClick={handleConfirmDisconnect}
              disabled={isSubmitting}
            >
              {t("steam_disconnect")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        visible={showDeleteDataModal}
        onClose={() => setShowDeleteDataModal(false)}
        title={t("steam_delete_confirm_title")}
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
            onClick={() => void handleDisconnect(true)}
            disabled={isSubmitting}
          >
            {t("steam_delete_confirm_button")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
