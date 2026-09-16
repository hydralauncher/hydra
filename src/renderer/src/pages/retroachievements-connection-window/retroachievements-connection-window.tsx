import { useEffect, useState } from "react";
import type { FormEventHandler } from "react";
import { Trans, useTranslation } from "react-i18next";
import { LinkExternalIcon } from "@primer/octicons-react";

import { Button, Link, TextField, WindowTitleBar } from "@renderer/components";
import retroAchievementsLogo from "@renderer/assets/icons/retroachievements.png";
import {
  getRetroAchievementsConnectErrorField,
  RETRO_ACHIEVEMENTS_INTEGRATION_ENDPOINT,
  type RetroAchievementsIntegration,
} from "@renderer/pages/settings/retroachievements-integration";

import "./retroachievements-connection-window.scss";

const RETRO_ACHIEVEMENTS_URL = "https://retroachievements.org";
const RETRO_ACHIEVEMENTS_WEB_API_KEY_URL =
  "https://retroachievements.org/settings?tab=applications";

interface FormErrors {
  password?: string;
  webApiKey?: string;
  form?: string;
}

export default function RetroAchievementsConnectionWindow() {
  const { t } = useTranslation("settings");
  const isLinux = globalThis.window.electron.platform === "linux";
  const [isInitializing, setIsInitializing] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    username: "",
    password: "",
    webApiKey: "",
  });
  const [errors, setErrors] = useState<FormErrors>({});

  useEffect(() => {
    let active = true;

    Promise.all([
      globalThis.window.electron.getUserPreferences(),
      globalThis.window.electron.hydraApi
        .get<RetroAchievementsIntegration>(
          RETRO_ACHIEVEMENTS_INTEGRATION_ENDPOINT
        )
        .catch(() => null),
    ])
      .then(([preferences, integration]) => {
        if (!active) return;

        setForm((current) => ({
          ...current,
          username:
            integration?.connected && integration.username
              ? integration.username
              : (preferences?.retroAchievementsUsername ?? ""),
          webApiKey: preferences?.retroAchievementsWebApiKey ?? "",
        }));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setIsInitializing(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({
      ...current,
      [field]: undefined,
      form: undefined,
    }));
  };

  const getErrorMessage = (message?: string) => {
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

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrors({});

    const webApiKey = form.webApiKey.trim();

    try {
      const integration =
        await globalThis.window.electron.hydraApi.post<RetroAchievementsIntegration>(
          `${RETRO_ACHIEVEMENTS_INTEGRATION_ENDPOINT}/connect`,
          {
            data: {
              username: form.username.trim(),
              password: form.password,
              webApiKey,
              deleteAchievements: false,
            },
          }
        );

      await globalThis.window.electron
        .updateUserPreferences({
          retroAchievementsWebApiKey: webApiKey,
          retroAchievementsUsername: integration.connected
            ? integration.username
            : form.username.trim(),
        })
        .catch(() => {});

      await globalThis.window.electron.completeRetroAchievementsConnectionWindow();
    } catch (error) {
      const message = error instanceof Error ? error.message : undefined;
      const field = getRetroAchievementsConnectErrorField(message);
      setErrors({ [field]: getErrorMessage(message) });
      setIsSubmitting(false);
    }
  };

  const isConnectDisabled =
    isInitializing ||
    isSubmitting ||
    !form.username.trim() ||
    !form.password.trim() ||
    !form.webApiKey.trim();

  return (
    <div
      className={`retroachievements-connection-window${
        isLinux ? " retroachievements-connection-window--linux" : ""
      }`}
    >
      {isLinux ? (
        <WindowTitleBar
          onMinimize={() =>
            globalThis.window.electron.minimizeRetroAchievementsConnectionWindow()
          }
          onClose={() =>
            globalThis.window.electron.closeRetroAchievementsConnectionWindow()
          }
        />
      ) : null}

      <main className="retroachievements-connection-window__content">
        <div className="retroachievements-connection-window__heading">
          <img src={retroAchievementsLogo} alt="" />
          <div>
            <h1>{t("retroachievements_connect_title")}</h1>
            <p>{t("retroachievements_description")}</p>
          </div>
        </div>

        <form
          className="retroachievements-connection-window__form"
          onSubmit={handleSubmit}
        >
          <TextField
            label={t("retroachievements_username")}
            value={form.username}
            onChange={(event) => updateField("username", event.target.value)}
            placeholder={t("retroachievements_username")}
          />
          <TextField
            label={t("retroachievements_password")}
            value={form.password}
            type="password"
            onChange={(event) => updateField("password", event.target.value)}
            placeholder={t("retroachievements_password")}
            error={errors.password}
          />
          <TextField
            label={t("retroachievements_web_api_key")}
            value={form.webApiKey}
            type="password"
            onChange={(event) => updateField("webApiKey", event.target.value)}
            placeholder={t("retroachievements_web_api_key")}
            error={errors.webApiKey}
            hint={
              <Trans i18nKey="retroachievements_web_api_key_hint" ns="settings">
                <Link to={RETRO_ACHIEVEMENTS_WEB_API_KEY_URL} />
              </Trans>
            }
          />

          {errors.form ? (
            <p
              className="retroachievements-connection-window__error"
              role="alert"
            >
              {errors.form}
            </p>
          ) : null}

          <p className="retroachievements-connection-window__emulator-note">
            {t("retroachievements_emulator_note")}
          </p>

          <Link
            to={RETRO_ACHIEVEMENTS_URL}
            className="retroachievements-connection-window__create-account"
          >
            <LinkExternalIcon size={14} />
            {t("retroachievements_create_account")}
          </Link>

          <div className="retroachievements-connection-window__actions">
            <Button
              theme="outline"
              onClick={() =>
                globalThis.window.electron.closeRetroAchievementsConnectionWindow()
              }
              disabled={isSubmitting}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={isConnectDisabled}>
              {t("integration_connect")}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}
