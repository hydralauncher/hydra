import { useContext, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Button, CheckboxField, Link, TextField } from "@renderer/components";
import "./settings-torbox.scss";

import { useAppSelector, useToast } from "@renderer/hooks";

import { settingsContext } from "@renderer/context";
import { LinkExternalIcon } from "@primer/octicons-react";

const torBoxReferralCode = import.meta.env.RENDERER_VITE_TORBOX_REFERRAL_CODE;

const TORBOX_URL = torBoxReferralCode
  ? `https://torbox.app/subscription?referral=${torBoxReferralCode}`
  : "https://torbox.app";
const TORBOX_API_TOKEN_URL = "https://torbox.app/settings";

export function SettingsTorBox() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { updateUserPreferences } = useContext(settingsContext);

  const [isLoading, setIsLoading] = useState(false);
  const [form, setForm] = useState({
    useTorBox: false,
    torBoxApiToken: null as string | null,
  });

  const { showSuccessToast, showErrorToast } = useToast();

  const { t } = useTranslation("settings");

  useEffect(() => {
    if (userPreferences) {
      setForm({
        useTorBox: Boolean(userPreferences.torBoxApiToken),
        torBoxApiToken: userPreferences.torBoxApiToken ?? null,
      });
    }
  }, [userPreferences]);

  const handleFormSubmit: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    setIsLoading(true);
    event.preventDefault();

    try {
      if (form.useTorBox) {
        const user = await window.electron.authenticateTorBox(
          form.torBoxApiToken!
        );

        showSuccessToast(
          t("torbox_account_linked"),
          t("debrid_linked_message", { username: user.email })
        );
      } else {
        showSuccessToast(t("changes_saved"));
      }

      updateUserPreferences({
        torBoxApiToken: form.useTorBox ? form.torBoxApiToken : null,
      });
    } catch (err) {
      showErrorToast(t("debrid_invalid_token"));
    } finally {
      setIsLoading(false);
    }
  };

  const isButtonDisabled =
    (form.useTorBox && !form.torBoxApiToken) || isLoading;

  const toggleTorBox = () => {
    const updatedValue = !form.useTorBox;

    setForm((prev) => ({
      ...prev,
      useTorBox: updatedValue,
    }));

    if (!updatedValue) {
      updateUserPreferences({
        torBoxApiToken: null,
      });
    }
  };

  return (
    <form className="settings-torbox__form" onSubmit={handleFormSubmit}>
      <div className="settings-torbox__description-container">
        <p className="settings-torbox__description">
          {t("torbox_description")}
        </p>
        <Link to={TORBOX_URL} className="settings-torbox__create-account">
          <LinkExternalIcon />
          {t("create_torbox_account")}
        </Link>
      </div>

      <CheckboxField
        label={t("enable_torbox")}
        checked={form.useTorBox}
        onChange={toggleTorBox}
      />

      {form.useTorBox && (
        <TextField
          label={t("api_token")}
          value={form.torBoxApiToken ?? ""}
          type="password"
          onChange={(event) =>
            setForm({ ...form, torBoxApiToken: event.target.value })
          }
          placeholder="API Token"
          rightContent={
            <Button type="submit" disabled={isButtonDisabled}>
              {t("save_changes")}
            </Button>
          }
          hint={
            <Trans i18nKey="debrid_api_token_hint" ns="settings">
              <Link to={TORBOX_API_TOKEN_URL} />
            </Trans>
          }
        />
      )}
    </form>
  );
}
