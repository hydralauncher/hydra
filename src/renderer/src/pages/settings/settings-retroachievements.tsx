import { useContext, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import {
  Button,
  CheckboxField,
  Link,
  Modal,
  TextField,
} from "@renderer/components";
import { useAppSelector, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import {
  AlertIcon,
  CheckCircleFillIcon,
  ChevronRightIcon,
  LinkExternalIcon,
  PersonIcon,
  QuestionIcon,
  SyncIcon,
} from "@primer/octicons-react";

import retroAchievementsLogo from "@renderer/assets/icons/retroachievements.png";

import "./settings-debrid.scss";
import "./settings-retroachievements.scss";

const RETRO_ACHIEVEMENTS_URL = "https://retroachievements.org";
const RETRO_ACHIEVEMENTS_WEB_API_KEY_URL =
  "https://retroachievements.org/settings";

const INTEGRATION_ENDPOINT = "/profile/integrations/retroachievements";

const RETRO_ACHIEVEMENTS_USER_PIC_URL =
  "https://media.retroachievements.org/UserPic";

const STATUS_ICON_SIZE = 14;
const CHEVRON_ICON_SIZE = 16;
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
  const { t } = useTranslation("settings");

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [integration, setIntegration] = useState<RetroAchievementsIntegration>({
    connected: false,
  });
  const [form, setForm] = useState({
    username: "",
    password: "",
    webApiKey: "",
  });
  const [isCollapsed, setIsCollapsed] = useState(
    () => !userPreferences?.retroAchievementsWebApiKey
  );
  const [avatarError, setAvatarError] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [showDeleteAchievementsModal, setShowDeleteAchievementsModal] =
    useState(false);
  const [deleteAchievementsOnDisconnect, setDeleteAchievementsOnDisconnect] =
    useState(false);

  const connectedUsername = integration.connected ? integration.username : null;

  useEffect(() => {
    setAvatarError(false);
  }, [connectedUsername]);

  useEffect(() => {
    let active = true;

    globalThis.window.electron.hydraApi
      .get<RetroAchievementsIntegration>(INTEGRATION_ENDPOINT)
      .then((status) => {
        if (active) setIntegration(status);
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

  const handleConnect: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
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
    setDeleteAchievementsOnDisconnect(false);
  };

  const handleConfirmDisconnect = () => {
    if (deleteAchievementsOnDisconnect) {
      setShowDisconnectModal(false);
      setShowDeleteAchievementsModal(true);
      return;
    }

    handleDisconnect(false);
  };

  const handleDisconnect = async (deleteAchievements: boolean) => {
    setShowDisconnectModal(false);
    setShowDeleteAchievementsModal(false);
    setDeleteAchievementsOnDisconnect(false);
    setIsSubmitting(true);

    try {
      await globalThis.window.electron.hydraApi.delete(
        `${INTEGRATION_ENDPOINT}?deleteAchievements=${deleteAchievements}`
      );

      setIntegration({ connected: false });
      setForm({ username: "", password: "", webApiKey: "" });
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

  const isConnectDisabled =
    !form.username.trim() ||
    !form.password.trim() ||
    !form.webApiKey.trim() ||
    isSubmitting;

  const renderBody = () => {
    if (isLoading) {
      return (
        <p className="settings-retroachievements__description">
          {t("retroachievements_loading")}
        </p>
      );
    }

    if (integration.connected) {
      const isInvalid =
        integration.retroAchievementsAccountStatus === "invalid_credentials";

      return (
        <div className="settings-retroachievements__connected">
          <div className="settings-retroachievements__profile">
            <div className="settings-retroachievements__avatar">
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

            <div className="settings-retroachievements__account">
              <span className="settings-retroachievements__username">
                {integration.username}
              </span>
              <span
                className={`settings-retroachievements__status ${
                  isInvalid ? "settings-retroachievements__status--warning" : ""
                }`}
              >
                {isInvalid ? (
                  <AlertIcon size={STATUS_ICON_SIZE} />
                ) : (
                  <CheckCircleFillIcon size={STATUS_ICON_SIZE} />
                )}
                {isInvalid
                  ? t("retroachievements_status_invalid_credentials")
                  : t("retroachievements_status_active")}
              </span>
            </div>
          </div>

          <div className="settings-retroachievements__actions">
            {!isInvalid && (
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
              onClick={() => {
                setDeleteAchievementsOnDisconnect(false);
                setShowDisconnectModal(true);
              }}
              disabled={isSubmitting || isRefreshing}
            >
              {t("retroachievements_disconnect")}
            </Button>
          </div>
        </div>
      );
    }

    return (
      <form
        className="settings-retroachievements__form"
        onSubmit={handleConnect}
      >
        <div className="settings-retroachievements__description-container">
          <p className="settings-retroachievements__description">
            {t("retroachievements_description")}
          </p>
          <Link
            to={RETRO_ACHIEVEMENTS_URL}
            className="settings-retroachievements__create-account"
          >
            <LinkExternalIcon />
            {t("retroachievements_create_account")}
          </Link>

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
        </div>

        <TextField
          label={t("retroachievements_username")}
          value={form.username}
          onChange={(event) =>
            setForm({ ...form, username: event.target.value })
          }
          placeholder={t("retroachievements_username")}
        />

        <TextField
          label={t("retroachievements_password")}
          value={form.password}
          type="password"
          onChange={(event) =>
            setForm({ ...form, password: event.target.value })
          }
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
            onClick={() => setIsCollapsed((prev) => !prev)}
            aria-label={
              isCollapsed
                ? t("expand_debrid_section", {
                    provider: t("retroachievements"),
                  })
                : t("collapse_debrid_section", {
                    provider: t("retroachievements"),
                  })
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
          <h3 className="settings-debrid__section-title">
            {t("retroachievements")}
          </h3>
          <img
            src={retroAchievementsLogo}
            alt=""
            className="settings-retroachievements__title-logo"
          />
          {integration.connected &&
            (integration.retroAchievementsAccountStatus ===
            "invalid_credentials" ? (
              <AlertIcon
                size={CHEVRON_ICON_SIZE}
                className="settings-retroachievements__header-icon--warning"
              />
            ) : (
              <CheckCircleFillIcon
                size={CHEVRON_ICON_SIZE}
                className="settings-debrid__check-icon"
              />
            ))}
        </div>

        {!isCollapsed && renderBody()}
      </div>

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
            onClick={() => handleDisconnect(true)}
            disabled={isSubmitting}
          >
            {t("retroachievements_delete_confirm_button")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
