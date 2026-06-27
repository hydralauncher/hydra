import { useContext, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Button, Link, TextField } from "@renderer/components";
import { useAppSelector, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import {
  AlertIcon,
  CheckCircleFillIcon,
  ChevronRightIcon,
  LinkExternalIcon,
} from "@primer/octicons-react";

import "./settings-debrid.scss";
import "./settings-retroachievements.scss";

const RETRO_ACHIEVEMENTS_URL = "https://retroachievements.org";
const RETRO_ACHIEVEMENTS_WEB_API_KEY_URL =
  "https://retroachievements.org/settings";

const INTEGRATION_ENDPOINT = "/profile/integrations/retroachievements";

const STATUS_ICON_SIZE = 14;
const CHEVRON_ICON_SIZE = 16;

type RetroAchievementsIntegration =
  | { connected: false }
  | {
      connected: true;
      username: string;
      raUserId: string | null;
      status: "active" | "invalid_credentials";
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

  useEffect(() => {
    let active = true;

    window.electron.hydraApi
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
        await window.electron.hydraApi.post<RetroAchievementsIntegration>(
          `${INTEGRATION_ENDPOINT}/connect`,
          {
            data: {
              username: form.username.trim(),
              password: form.password,
              webApiKey,
            },
          }
        );

      setIntegration(status);
      setForm((prev) => ({ ...prev, password: "" }));
      showSuccessToast(t("retroachievements_account_linked"));

      await updateUserPreferences({
        retroAchievementsWebApiKey: webApiKey,
      }).catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : undefined;
      showErrorToast(getConnectErrorMessage(message));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisconnect = async () => {
    setIsSubmitting(true);

    try {
      await window.electron.hydraApi.delete(INTEGRATION_ENDPOINT);

      setIntegration({ connected: false });
      setForm({ username: "", password: "", webApiKey: "" });
      showSuccessToast(t("retroachievements_account_unlinked"));

      await updateUserPreferences({ retroAchievementsWebApiKey: null }).catch(
        () => {}
      );
    } catch {
      showErrorToast(t("retroachievements_connect_error"));
    } finally {
      setIsSubmitting(false);
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
      const isInvalid = integration.status === "invalid_credentials";

      return (
        <div className="settings-retroachievements__connected">
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

          <Button
            theme="outline"
            onClick={handleDisconnect}
            disabled={isSubmitting}
          >
            {t("retroachievements_disconnect")}
          </Button>
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
        {integration.connected && (
          <CheckCircleFillIcon
            size={CHEVRON_ICON_SIZE}
            className="settings-debrid__check-icon"
          />
        )}
      </div>

      {!isCollapsed && renderBody()}
    </div>
  );
}
