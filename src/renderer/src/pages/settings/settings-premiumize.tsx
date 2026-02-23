import { useContext, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button, CheckboxField, Link, TextField } from "@renderer/components";
import { useAppSelector, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import { LinkExternalIcon } from "@primer/octicons-react";
import "./settings-premiumize.scss";

const PREMIUMIZE_URL = "https://www.premiumize.me";
const PREMIUMIZE_API_TOKEN_URL = "https://www.premiumize.me/account";

export function SettingsPremiumize() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();
  const { t } = useTranslation("settings");

  const [isLoading, setIsLoading] = useState(false);
  const [form, setForm] = useState({
    usePremiumize: false,
    premiumizeApiToken: null as string | null,
  });

  useEffect(() => {
    if (userPreferences) {
      setForm({
        usePremiumize: Boolean(userPreferences.premiumizeApiToken),
        premiumizeApiToken: userPreferences.premiumizeApiToken ?? null,
      });
    }
  }, [userPreferences]);

  const handleFormSubmit: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    setIsLoading(true);
    event.preventDefault();

    try {
      if (form.usePremiumize) {
        const user = await window.electron.authenticatePremiumize(
          form.premiumizeApiToken!
        );

        showSuccessToast(
          t("premiumize_account_linked"),
          t("debrid_linked_message", { username: user.customer_id })
        );
      } else {
        showSuccessToast(t("changes_saved"));
      }

      updateUserPreferences({
        premiumizeApiToken: form.usePremiumize ? form.premiumizeApiToken : null,
      });
    } catch {
      showErrorToast(t("debrid_invalid_token"));
    } finally {
      setIsLoading(false);
    }
  };

  const togglePremiumize = () => {
    const updatedValue = !form.usePremiumize;

    setForm((prev) => ({
      ...prev,
      usePremiumize: updatedValue,
    }));

    if (!updatedValue) {
      updateUserPreferences({
        premiumizeApiToken: null,
      });
    }
  };

  const isButtonDisabled =
    (form.usePremiumize && !form.premiumizeApiToken) || isLoading;

  return (
    <form className="settings-premiumize__form" onSubmit={handleFormSubmit}>
      <div className="settings-premiumize__description-container">
        <p className="settings-premiumize__description">
          {t("premiumize_description")}
        </p>
        <Link
          to={PREMIUMIZE_URL}
          className="settings-premiumize__create-account"
        >
          <LinkExternalIcon />
          {t("create_premiumize_account")}
        </Link>
      </div>

      <CheckboxField
        label={t("enable_premiumize")}
        checked={form.usePremiumize}
        onChange={togglePremiumize}
      />

      {form.usePremiumize && (
        <TextField
          label={t("api_token")}
          value={form.premiumizeApiToken ?? ""}
          type="password"
          onChange={(event) =>
            setForm({ ...form, premiumizeApiToken: event.target.value })
          }
          rightContent={
            <Button type="submit" disabled={isButtonDisabled}>
              {t("save_changes")}
            </Button>
          }
          placeholder={t("api_token")}
          hint={
            <Trans i18nKey="debrid_api_token_hint" ns="settings">
              <Link to={PREMIUMIZE_API_TOKEN_URL} />
            </Trans>
          }
        />
      )}
    </form>
  );
}
