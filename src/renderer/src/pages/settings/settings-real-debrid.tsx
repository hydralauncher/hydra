import { useContext, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Button, CheckboxField, Link, TextField } from "@renderer/components";
import "./settings-real-debrid.scss";

import { useAppSelector, useToast } from "@renderer/hooks";

import { settingsContext } from "@renderer/context";
import { LinkExternalIcon } from "@primer/octicons-react";

const realDebridReferralId = import.meta.env
  .RENDERER_VITE_REAL_DEBRID_REFERRAL_ID;

const REAL_DEBRID_URL = realDebridReferralId
  ? `https://real-debrid.com/?id=${realDebridReferralId}`
  : "https://real-debrid.com";
const REAL_DEBRID_API_TOKEN_URL = "https://real-debrid.com/apitoken";

export function SettingsRealDebrid() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { updateUserPreferences } = useContext(settingsContext);

  const [isLoading, setIsLoading] = useState(false);
  const [form, setForm] = useState({
    useRealDebrid: false,
    realDebridApiToken: null as string | null,
  });

  const { showSuccessToast, showErrorToast } = useToast();

  const { t } = useTranslation("settings");

  useEffect(() => {
    if (userPreferences) {
      setForm({
        useRealDebrid: Boolean(userPreferences.realDebridApiToken),
        realDebridApiToken: userPreferences.realDebridApiToken ?? null,
      });
    }
  }, [userPreferences]);

  const handleFormSubmit: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    setIsLoading(true);
    event.preventDefault();

    try {
      if (form.useRealDebrid) {
        const user = await window.electron.authenticateRealDebrid(
          form.realDebridApiToken!
        );

        if (user.type === "free") {
          showErrorToast(
            t("real_debrid_free_account_error", { username: user.username })
          );

          return;
        } else {
          showSuccessToast(
            t("real_debrid_account_linked"),
            t("debrid_linked_message", { username: user.username })
          );
        }
      } else {
        showSuccessToast(t("changes_saved"));
      }

      updateUserPreferences({
        realDebridApiToken: form.useRealDebrid ? form.realDebridApiToken : null,
      });
    } catch (err) {
      showErrorToast(t("debrid_invalid_token"));
    } finally {
      setIsLoading(false);
    }
  };

  const toggleRealDebrid = () => {
    const updatedValue = !form.useRealDebrid;

    setForm((prev) => ({
      ...prev,
      useRealDebrid: updatedValue,
    }));

    if (!updatedValue) {
      updateUserPreferences({
        realDebridApiToken: null,
      });
    }
  };

  const isButtonDisabled =
    (form.useRealDebrid && !form.realDebridApiToken) || isLoading;

  return (
    <form className="settings-real-debrid__form" onSubmit={handleFormSubmit}>
      <div className="settings-real-debrid__description-container">
        <p className="settings-real-debrid__description">
          {t("real_debrid_description")}
        </p>
        <Link
          to={REAL_DEBRID_URL}
          className="settings-real-debrid__create-account"
        >
          <LinkExternalIcon />
          {t("create_real_debrid_account")}
        </Link>
      </div>

      <CheckboxField
        label={t("enable_real_debrid")}
        checked={form.useRealDebrid}
        onChange={toggleRealDebrid}
      />

      {form.useRealDebrid && (
        <TextField
          label={t("api_token")}
          value={form.realDebridApiToken ?? ""}
          type="password"
          onChange={(event) =>
            setForm({ ...form, realDebridApiToken: event.target.value })
          }
          rightContent={
            <Button type="submit" disabled={isButtonDisabled}>
              {t("save_changes")}
            </Button>
          }
          placeholder="API Token"
          hint={
            <Trans i18nKey="debrid_api_token_hint" ns="settings">
              <Link to={REAL_DEBRID_API_TOKEN_URL} />
            </Trans>
          }
        />
      )}
    </form>
  );
}
