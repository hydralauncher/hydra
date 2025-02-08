import { useContext, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Button, CheckboxField, Link, TextField } from "@renderer/components";
import "./settings-all-debrid.scss";

import { useAppSelector, useToast } from "@renderer/hooks";

import { settingsContext } from "@renderer/context";

const ALL_DEBRID_API_TOKEN_URL = "https://alldebrid.com/apikeys";

export function SettingsAllDebrid() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { updateUserPreferences } = useContext(settingsContext);

  const [isLoading, setIsLoading] = useState(false);
  const [form, setForm] = useState({
    useAllDebrid: false,
    allDebridApiKey: null as string | null,
  });

  const { showSuccessToast, showErrorToast } = useToast();

  const { t } = useTranslation("settings");

  useEffect(() => {
    if (userPreferences) {
      setForm({
        useAllDebrid: Boolean(userPreferences.allDebridApiKey),
        allDebridApiKey: userPreferences.allDebridApiKey ?? null,
      });
    }
  }, [userPreferences]);

  const handleFormSubmit: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    setIsLoading(true);
    event.preventDefault();

    try {
      if (form.useAllDebrid) {
        if (!form.allDebridApiKey) {
          showErrorToast(t("alldebrid_missing_key"));
          return;
        }

        const result = await window.electron.authenticateAllDebrid(
          form.allDebridApiKey
        );

        if ('error_code' in result) {
          showErrorToast(t(result.error_code));
          return;
        }

        if (!result.isPremium) {
          showErrorToast(
            t("all_debrid_free_account_error", { username: result.username })
          );
          return;
        }

        showSuccessToast(
          t("all_debrid_account_linked"),
          t("debrid_linked_message", { username: result.username })
        );
      } else {
        showSuccessToast(t("changes_saved"));
      }

      updateUserPreferences({
        allDebridApiKey: form.useAllDebrid ? form.allDebridApiKey : null,
      });
    } catch (err: any) {
      showErrorToast(t("alldebrid_unknown_error"));
    } finally {
      setIsLoading(false);
    }
  };

  const isButtonDisabled =
    (form.useAllDebrid && !form.allDebridApiKey) || isLoading;

  return (
    <form className="settings-all-debrid__form" onSubmit={handleFormSubmit}>
      <p className="settings-all-debrid__description">
        {t("all_debrid_description")}
      </p>

      <CheckboxField
        label={t("enable_all_debrid")}
        checked={form.useAllDebrid}
        onChange={() =>
          setForm((prev) => ({
            ...prev,
            useAllDebrid: !form.useAllDebrid,
          }))
        }
      />

      {form.useAllDebrid && (
        <TextField
          label={t("api_token")}
          value={form.allDebridApiKey ?? ""}
          type="password"
          onChange={(event) =>
            setForm({ ...form, allDebridApiKey: event.target.value })
          }
          rightContent={
            <Button type="submit" disabled={isButtonDisabled}>
              {t("save_changes")}
            </Button>
          }
          placeholder="API Key"
          hint={
            <Trans i18nKey="debrid_api_token_hint" ns="settings">
              <Link to={ALL_DEBRID_API_TOKEN_URL} />
            </Trans>
          }
        />
      )}
    </form>
  );
} 