import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CheckboxField, TextField } from "@renderer/components";
import "./settings-webdav.scss";
import { useAppSelector, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";

export function SettingsWebDav() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { updateUserPreferences } = useContext(settingsContext);

  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [form, setForm] = useState({
    useWebDav: false,
    webDavHost: "",
    webDavUsername: "",
    webDavPassword: "",
    webDavLocation: "",
  });

  const { showSuccessToast, showErrorToast } = useToast();
  const { t } = useTranslation("settings");

  useEffect(() => {
    if (userPreferences) {
      setForm({
        useWebDav: Boolean(userPreferences.webDavHost),
        webDavHost: userPreferences.webDavHost ?? "",
        webDavUsername: userPreferences.webDavUsername ?? "",
        webDavPassword: userPreferences.webDavPassword ?? "",
        webDavLocation: userPreferences.webDavLocation ?? "",
      });
    }
  }, [userPreferences]);

  const toggleWebDav = () => {
    const updatedValue = !form.useWebDav;

    setForm((prev) => ({ ...prev, useWebDav: updatedValue }));

    if (!updatedValue) {
      updateUserPreferences({
        webDavHost: null,
        webDavUsername: null,
        webDavPassword: null,
        webDavLocation: null,
      });
    }
  };

  const handleFormSubmit: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    event.preventDefault();
    setIsLoading(true);

    try {
      await updateUserPreferences({
        webDavHost: form.webDavHost || null,
        webDavUsername: form.webDavUsername || null,
        webDavPassword: form.webDavPassword || null,
        webDavLocation: form.webDavLocation || null,
      });

      showSuccessToast(t("changes_saved"));
    } catch {
      showErrorToast(t("webdav_save_failed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestConnection = async () => {
    if (!form.webDavHost || !form.webDavUsername || !form.webDavPassword) {
      showErrorToast(t("webdav_missing_credentials"));
      return;
    }

    setIsTesting(true);

    try {
      await window.electron.testWebDavConnection(
        form.webDavHost,
        form.webDavUsername,
        form.webDavPassword
      );
      showSuccessToast(t("webdav_connection_success"));
    } catch {
      showErrorToast(t("webdav_connection_failed"));
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <form className="settings-webdav__form" onSubmit={handleFormSubmit}>
      <p className="settings-webdav__description">{t("webdav_description")}</p>

      <CheckboxField
        label={t("enable_webdav")}
        checked={form.useWebDav}
        onChange={toggleWebDav}
      />

      {form.useWebDav && (
        <>
          <TextField
            label={t("webdav_host")}
            value={form.webDavHost}
            placeholder="https://example.com/webdav"
            onChange={(event) =>
              setForm({ ...form, webDavHost: event.target.value })
            }
          />

          <TextField
            label={t("webdav_username")}
            value={form.webDavUsername}
            onChange={(event) =>
              setForm({ ...form, webDavUsername: event.target.value })
            }
            placeholder={t("webdav_username")}
          />

          <TextField
            label={t("webdav_password")}
            value={form.webDavPassword}
            type="password"
            onChange={(event) =>
              setForm({ ...form, webDavPassword: event.target.value })
            }
            placeholder={t("webdav_password")}
          />

          <TextField
            label={t("webdav_location")}
            value={form.webDavLocation}
            placeholder="/hydra-backups"
            onChange={(event) =>
              setForm({ ...form, webDavLocation: event.target.value })
            }
            hint={t("webdav_location_hint")}
          />

          <div className="settings-webdav__actions">
            <Button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting || isLoading}
              theme="outline"
            >
              {isTesting ? t("webdav_testing") : t("webdav_test_connection")}
            </Button>

            <Button type="submit" disabled={isLoading}>
              {t("save_changes")}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
