import { useContext, useEffect, useState } from "react";
import type { FormEventHandler } from "react";
import { Trans, useTranslation } from "react-i18next";

import {
  Button,
  CheckboxField,
  Link,
  Modal,
  TextField,
} from "@renderer/components";
import { useAppSelector, useDate, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import {
  LinkExternalIcon,
  PersonIcon,
  QuestionIcon,
  SyncIcon,
} from "@primer/octicons-react";

import retroAchievementsLogo from "@renderer/assets/icons/retroachievements.png";
import { SettingsIntegrationCard } from "./settings-integration-card";

import "./settings-retroachievements.scss";

const RETRO_ACHIEVEMENTS_URL = "https://retroachievements.org";
const RETRO_ACHIEVEMENTS_WEB_API_KEY_URL =
  "https://retroachievements.org/settings?tab=applications";

const INTEGRATION_ENDPOINT = "/profile/integrations/retroachievements";
const RETRO_ACHIEVEMENTS_USER_PIC_URL =
  "https://media.retroachievements.org/UserPic";

const STATUS_ICON_SIZE = 14;
const AVATAR_FALLBACK_ICON_SIZE = 28;

type RetroAchievementsIntegration =
  | { connected: false }
  | {
      connected: true;
      username: string;
      retroAchievementsUserId: string | null;
      retroAchievementsAccountStatus: "active" | "invalid_credentials";
    };

export function SettingsRetroAchievements() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();
  const { formatDateTime } = useDate();
  const { t } = useTranslation("settings");

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [integration, setIntegration] = useState<RetroAchievementsIntegration>({
    connected: false,
  });
  const [form, setForm] = useState(() => ({
    username: "",
    password: "",
    webApiKey: userPreferences?.retroAchievementsWebApiKey ?? "",
  }));
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

  useEffect(() => {
    let active = true;

    globalThis.window.electron.hydraApi
      .get<RetroAchievementsIntegration>(INTEGRATION_ENDPOINT)
      .then((status) => {
        if (active) {
          setIntegration(status);
          setLastCheckedAt(new Date().toISOString());
        }
      })
      .catch(() => {
        if (active) setIntegration({ connected: false });
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const storedKey = userPreferences?.retroAchievementsWebApiKey;

    if (!integration.connected && storedKey) {
      setForm((prev) => ({
        ...prev,
        webApiKey: prev.webApiKey || storedKey,
      }));
    }
  }, [integration.connected, userPreferences?.retroAchievementsWebApiKey]);

  const getConnectErrorMessage = (message?: string) => {
    switch (message) {
      case "profile/retroachievements-invalid-password":
        return t("retroachievements_invalid_password");
      case "profile/retroachievements-invalid-web-api-key":
        return t("retroachievements_invalid_web_api_key");
      case "profile/retroachievements-missing-credentials":
        return t("retroachievements_missing_credentials");
      default:
        return t("retroachievements_connect_error");
    }
  };

  const handleConnect: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);

    const webApiKey = form.webApiKey.trim();

    try {
      const status =
        await globalThis.window.electron.hydraApi.post<RetroAchievementsIntegration>(
          `${INTEGRATION_ENDPOINT}/connect`,
          {
            data: {
              username: form.username.trim(),
              password: form.password,
              webApiKey,
              deleteAchievements: false,
            },
          }
        );

      setIntegration(status);
      setForm((prev) => ({ ...prev, password: "" }));
      setLastCheckedAt(new Date().toISOString());
      setShowConnectForm(false);
      showSuccessToast(t("retroachievements_account_linked"));

      await updateUserPreferences({
        retroAchievementsWebApiKey: webApiKey,
        retroAchievementsUsername: status.connected ? status.username : null,
      }).catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : undefined;
      showErrorToast(getConnectErrorMessage(message));
    } finally {
      setIsSubmitting(false);
    }
  };

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
        `${INTEGRATION_ENDPOINT}?deleteAchievements=${deleteAchievements}`
      );

      if (deleteAchievements) {
        await globalThis.window.electron.resetRetroAchievementsAchievements();
      }

      setIntegration({ connected: false });
      setForm({ username: "", password: "", webApiKey: "" });
      setLastCheckedAt(null);
      setShowConnectForm(false);
      showSuccessToast(t("retroachievements_account_unlinked"));

      await updateUserPreferences({
        retroAchievementsWebApiKey: null,
        retroAchievementsUsername: null,
      }).catch(() => {});
    } catch {
      showErrorToast(t("retroachievements_connect_error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);

    try {
      const status =
        await globalThis.window.electron.hydraApi.get<RetroAchievementsIntegration>(
          INTEGRATION_ENDPOINT
        );

      setIntegration(status);
      setLastCheckedAt(new Date().toISOString());
      showSuccessToast(t("retroachievements_status_updated"));

      await updateUserPreferences({
        retroAchievementsUsername: status.connected ? status.username : null,
      }).catch(() => {});
    } catch {
      showErrorToast(t("retroachievements_connect_error"));
    } finally {
      setIsRefreshing(false);
    }
  };

  const openConnectForm = () => {
    if (integration.connected) {
      setForm((current) => ({ ...current, username: integration.username }));
    }

    setShowConnectForm(true);
  };

  const isConnectDisabled =
    !form.username.trim() ||
    !form.password.trim() ||
    !form.webApiKey.trim() ||
    isSubmitting;

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

  const renderConnectForm = () => (
    <form className="settings-retroachievements__form" onSubmit={handleConnect}>
      <div className="settings-retroachievements__form-intro">
        <p className="settings-integration-card__description">
          {t("retroachievements_description")}
        </p>
        <Link
          to={RETRO_ACHIEVEMENTS_URL}
          className="settings-retroachievements__create-account"
        >
          <LinkExternalIcon />
          {t("retroachievements_create_account")}
        </Link>
        {emulatorNote}
      </div>

      <TextField
        label={t("retroachievements_username")}
        value={form.username}
        onChange={(event) => setForm({ ...form, username: event.target.value })}
        placeholder={t("retroachievements_username")}
      />
      <TextField
        label={t("retroachievements_password")}
        value={form.password}
        type="password"
        onChange={(event) => setForm({ ...form, password: event.target.value })}
        placeholder={t("retroachievements_password")}
      />
      <TextField
        label={t("retroachievements_web_api_key")}
        value={form.webApiKey}
        type="password"
        onChange={(event) =>
          setForm({ ...form, webApiKey: event.target.value })
        }
        placeholder={t("retroachievements_web_api_key")}
        hint={
          <Trans i18nKey="retroachievements_web_api_key_hint" ns="settings">
            <Link to={RETRO_ACHIEVEMENTS_WEB_API_KEY_URL} />
          </Trans>
        }
      />
      <Button
        type="submit"
        className="settings-retroachievements__submit-button"
        disabled={isConnectDisabled}
      >
        {t("retroachievements_connect")}
      </Button>
    </form>
  );

  const renderBody = () => {
    if (isLoading) {
      return (
        <p className="settings-integration-card__description">
          {t("retroachievements_loading")}
        </p>
      );
    }

    if (showConnectForm) return renderConnectForm();

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

  const openDisconnectModal = () => {
    setDeleteAchievementsOnDisconnect(true);
    setShowDisconnectModal(true);
  };

  const renderActions = () => {
    if (isLoading) return null;

    if (showConnectForm) {
      return (
        <Button
          theme="outline"
          onClick={() => setShowConnectForm(false)}
          disabled={isSubmitting}
        >
          {t("cancel")}
        </Button>
      );
    }

    if (!integration.connected) {
      return (
        <Button onClick={openConnectForm} disabled={isSubmitting}>
          {t("retroachievements_connect")}
        </Button>
      );
    }

    return (
      <>
        {isInvalid ? (
          <Button onClick={openConnectForm} disabled={isSubmitting}>
            {t("retroachievements_reconnect")}
          </Button>
        ) : (
          <Button
            theme="outline"
            onClick={handleRefresh}
            disabled={isRefreshing || isSubmitting}
          >
            <SyncIcon size={STATUS_ICON_SIZE} />
            {t("retroachievements_update")}
          </Button>
        )}
        <Button
          theme="danger"
          onClick={openDisconnectModal}
          disabled={isSubmitting || isRefreshing}
        >
          {t("retroachievements_disconnect")}
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
              {t("retroachievements_disconnect")}
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
