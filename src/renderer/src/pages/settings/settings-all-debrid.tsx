import { useContext, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button, CheckboxField, Link, TextField } from "@renderer/components";
import { useAppSelector, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import { LinkExternalIcon } from "@primer/octicons-react";
import "./settings-all-debrid.scss";

const ALLDEBRID_URL = "https://alldebrid.com";
const ALLDEBRID_API_TOKEN_URL = "https://alldebrid.com/apikeys/";

export function SettingsAllDebrid() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();
  const { t } = useTranslation("settings");

  const [isLoading, setIsLoading] = useState(false);
  const [form, setForm] = useState({
    useAllDebrid: false,
    allDebridApiToken: null as string | null,
  });

  useEffect(() => {
    if (userPreferences) {
      setForm({
        useAllDebrid: Boolean(userPreferences.allDebridApiToken),
        allDebridApiToken: userPreferences.allDebridApiToken ?? null,
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
        const user = await window.electron.authenticateAllDebrid(
          form.allDebridApiToken!
        );

        showSuccessToast(
          t("alldebrid_account_linked"),
          t("debrid_linked_message", { username: user.username })
        );
      } else {
        showSuccessToast(t("changes_saved"));
      }

      updateUserPreferences({
        allDebridApiToken: form.useAllDebrid ? form.allDebridApiToken : null,
      });
    } catch {
      showErrorToast(t("debrid_invalid_token"));
    } finally {
      setIsLoading(false);
    }
  };

  const toggleAllDebrid = () => {
    const updatedValue = !form.useAllDebrid;

    setForm((prev) => ({
      ...prev,
      useAllDebrid: updatedValue,
    }));

    if (!updatedValue) {
      updateUserPreferences({
        allDebridApiToken: null,
      });
    }
  };

  const isButtonDisabled =
    (form.useAllDebrid && !form.allDebridApiToken) || isLoading;

  return (
    <form className="settings-all-debrid__form" onSubmit={handleFormSubmit}>
      <div className="settings-all-debrid__description-container">
        <p className="settings-all-debrid__description">
          {t("alldebrid_description")}
        </p>
        <Link
          to={ALLDEBRID_URL}
          className="settings-all-debrid__create-account"
        >
          <LinkExternalIcon />
          {t("create_alldebrid_account")}
        </Link>
      </div>

      <CheckboxField
        label={t("enable_alldebrid")}
        checked={form.useAllDebrid}
        onChange={toggleAllDebrid}
      />

      {form.useAllDebrid && (
        <TextField
          label={t("api_token")}
          value={form.allDebridApiToken ?? ""}
          type="password"
          onChange={(event) =>
            setForm({ ...form, allDebridApiToken: event.target.value })
          }
          rightContent={
            <Button type="submit" disabled={isButtonDisabled}>
              {t("save_changes")}
            </Button>
          }
          placeholder={t("api_token")}
          hint={
            <Trans i18nKey="debrid_api_token_hint" ns="settings">
              <Link to={ALLDEBRID_API_TOKEN_URL} />
            </Trans>
          }
        />
      )}
    </form>
  );
}
