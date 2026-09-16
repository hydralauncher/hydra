import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, CheckboxField, Modal } from "@renderer/components";
import { useDate, useToast } from "@renderer/hooks";
import {
  LinkExternalIcon,
  PersonIcon,
  QuestionIcon,
  SyncIcon,
} from "@primer/octicons-react";

import retroAchievementsLogo from "@renderer/assets/icons/retroachievements.png";
import { SettingsIntegrationCard } from "./settings-integration-card";
import {
  RETRO_ACHIEVEMENTS_INTEGRATION_ENDPOINT,
  type RetroAchievementsIntegration,
} from "./retroachievements-integration";

import "./settings-retroachievements.scss";

const RETRO_ACHIEVEMENTS_USER_PIC_URL =
  "https://media.retroachievements.org/UserPic";

const STATUS_ICON_SIZE = 14;
const AVATAR_FALLBACK_ICON_SIZE = 28;

export function SettingsRetroAchievements() {
  const { showSuccessToast, showErrorToast } = useToast();
  const { formatDateTime } = useDate();
  const { t } = useTranslation("settings");

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [integration, setIntegration] = useState<RetroAchievementsIntegration>({
    connected: false,
  });
  const [avatarError, setAvatarError] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [showDeleteAchievementsModal, setShowDeleteAchievementsModal] =
    useState(false);
  const [deleteAchievementsOnDisconnect, setDeleteAchievementsOnDisconnect] =
    useState(true);

  const connectedUsername = integration.connected ? integration.username : null;
  const isInvalid =
    integration.connected &&
    integration.retroAchievementsAccountStatus === "invalid_credentials";

  useEffect(() => {
    setAvatarError(false);
  }, [connectedUsername]);

  const refreshStatus = useCallback(
    async (options?: { silent?: boolean; toastOnConnect?: boolean }) => {
      if (!options?.silent) setIsLoading(true);

      try {
        const status =
          await globalThis.window.electron.hydraApi.get<RetroAchievementsIntegration>(
            RETRO_ACHIEVEMENTS_INTEGRATION_ENDPOINT
          );

        setIntegration(status);
        setLastCheckedAt(new Date().toISOString());

        if (options?.toastOnConnect && status.connected) {
          showSuccessToast(t("retroachievements_account_linked"));
        }
      } catch {
        if (!options?.silent) setIntegration({ connected: false });
      } finally {
        setIsLoading(false);
      }
    },
    [showSuccessToast, t]
  );

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    return globalThis.window.electron.onRetroAchievementsConnected(() => {
      void refreshStatus({ silent: true, toastOnConnect: true });
    });
  }, [refreshStatus]);

  const closeDisconnectModal = () => {
    setShowDisconnectModal(false);
    setDeleteAchievementsOnDisconnect(true);
  };

  const handleConfirmDisconnect = () => {
    if (deleteAchievementsOnDisconnect) {
      setShowDisconnectModal(false);
      setShowDeleteAchievementsModal(true);
      return;
    }

    void handleDisconnect(false);
  };

  const handleDisconnect = async (deleteAchievements: boolean) => {
    setShowDisconnectModal(false);
    setShowDeleteAchievementsModal(false);
    setDeleteAchievementsOnDisconnect(true);
    setIsSubmitting(true);

    try {
      if (deleteAchievements) {
        await globalThis.window.electron.resetRetroAchievementsAchievements(
          true
        );
      }

      await globalThis.window.electron.hydraApi.delete(
        `${RETRO_ACHIEVEMENTS_INTEGRATION_ENDPOINT}?deleteAchievements=${deleteAchievements}`
      );

      if (deleteAchievements) {
        await globalThis.window.electron.resetRetroAchievementsAchievements();
      }

      setIntegration({ connected: false });
      setLastCheckedAt(null);
      showSuccessToast(t("retroachievements_account_unlinked"));

      await globalThis.window.electron
        .updateUserPreferences({
          retroAchievementsWebApiKey: null,
          retroAchievementsUsername: null,
        })
        .catch(() => {});
    } catch {
      showErrorToast(t("retroachievements_connect_error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSync = async () => {
    setIsRefreshing(true);

    try {
      const status =
        await globalThis.window.electron.hydraApi.get<RetroAchievementsIntegration>(
          RETRO_ACHIEVEMENTS_INTEGRATION_ENDPOINT
        );

      setIntegration(status);
      setLastCheckedAt(new Date().toISOString());
      showSuccessToast(t("retroachievements_status_updated"));

      await globalThis.window.electron
        .updateUserPreferences({
          retroAchievementsUsername: status.connected ? status.username : null,
        })
        .catch(() => {});
    } catch {
      showErrorToast(t("retroachievements_connect_error"));
    } finally {
      setIsRefreshing(false);
    }
  };

  const openConnectionWindow = () => {
    void globalThis.window.electron.openRetroAchievementsConnectionWindow();
  };

  const emulatorNote = (
    <p className="settings-retroachievements__emulator-note">
      {t("retroachievements_emulator_note")}{" "}
      <small
        className="settings-retroachievements__guide-tooltip"
        data-open-article="retroachievements-emulators"
        title={t("retroachievements_view_guide")}
      >
        <QuestionIcon size={12} />
      </small>
    </p>
  );

  const renderBody = () => {
    if (integration.connected) {
      return (
        <>
          <div className="settings-integration-card__profile">
            <div className="settings-integration-card__avatar">
              {avatarError ? (
                <PersonIcon size={AVATAR_FALLBACK_ICON_SIZE} />
              ) : (
                <img
                  src={`${RETRO_ACHIEVEMENTS_USER_PIC_URL}/${encodeURIComponent(
                    integration.username
                  )}.png`}
                  alt={integration.username}
                  onError={() => setAvatarError(true)}
                />
              )}
            </div>
            <div className="settings-integration-card__account">
              <span className="settings-integration-card__username">
                {integration.username}
              </span>
              {lastCheckedAt ? (
                <span className="settings-integration-card__meta">
                  {t("retroachievements_last_checked", {
                    date: formatDateTime(lastCheckedAt),
                  })}
                </span>
              ) : null}
            </div>
          </div>

          {isInvalid ? (
            <p className="settings-integration-card__message">
              {t("retroachievements_invalid_credentials_description")}
            </p>
          ) : null}
        </>
      );
    }

    return (
      <>
        <p className="settings-integration-card__description">
          {t("retroachievements_description")}
        </p>
        {emulatorNote}
      </>
    );
  };

  const renderActions = () => {
    if (!integration.connected) {
      return (
        <Button onClick={openConnectionWindow} disabled={isSubmitting}>
          <LinkExternalIcon size={STATUS_ICON_SIZE} />
          {t("integration_connect")}
        </Button>
      );
    }

    return (
      <>
        {isInvalid ? (
          <Button onClick={openConnectionWindow} disabled={isSubmitting}>
            <LinkExternalIcon size={STATUS_ICON_SIZE} />
            {t("integration_reconnect")}
          </Button>
        ) : (
          <Button
            theme="outline"
            onClick={handleSync}
            disabled={isRefreshing || isSubmitting}
          >
            <SyncIcon size={STATUS_ICON_SIZE} />
            {t("integration_sync")}
          </Button>
        )}
        <Button
          theme="danger"
          onClick={() => {
            setDeleteAchievementsOnDisconnect(true);
            setShowDisconnectModal(true);
          }}
          disabled={isSubmitting || isRefreshing}
        >
          {t("integration_disconnect")}
        </Button>
      </>
    );
  };

  const status = isInvalid
    ? t("retroachievements_status_invalid_credentials")
    : integration.connected
      ? t("retroachievements_status_active")
      : t("integration_status_not_connected");

  return (
    <>
      <SettingsIntegrationCard
        title={t("retroachievements")}
        logo={<img src={retroAchievementsLogo} alt="" />}
        status={status}
        statusTone={
          isInvalid ? "warning" : integration.connected ? "success" : "neutral"
        }
        actions={renderActions()}
        loading={isLoading}
      >
        {renderBody()}
      </SettingsIntegrationCard>

      <Modal
        visible={showDisconnectModal}
        onClose={closeDisconnectModal}
        title={t("retroachievements_disconnect_title")}
      >
        <div className="settings-retroachievements__modal">
          <p className="settings-retroachievements__modal-note">
            {t("retroachievements_disconnect_description")}
          </p>
          <CheckboxField
            label={t("retroachievements_delete_on_disconnect")}
            checked={deleteAchievementsOnDisconnect}
            onChange={() => setDeleteAchievementsOnDisconnect((prev) => !prev)}
          />
          <div className="settings-retroachievements__modal-actions">
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
              {t("integration_disconnect")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        visible={showDeleteAchievementsModal}
        onClose={() => setShowDeleteAchievementsModal(false)}
        title={t("retroachievements_delete_confirm_title")}
        description={t("retroachievements_delete_confirm_description")}
      >
        <div className="settings-retroachievements__modal-actions">
          <Button
            theme="outline"
            onClick={() => setShowDeleteAchievementsModal(false)}
            disabled={isSubmitting}
          >
            {t("cancel")}
          </Button>
          <Button
            theme="danger"
            onClick={() => void handleDisconnect(true)}
            disabled={isSubmitting}
          >
            {t("retroachievements_delete_confirm_button")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
