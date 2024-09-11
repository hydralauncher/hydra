import { useContext, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Button, CheckboxField, Link, TextField } from "@renderer/components";
import * as styles from "./settings-torbox.css";

import { useAppSelector, useToast } from "@renderer/hooks";

import { SPACING_UNIT } from "@renderer/theme.css";
import { settingsContext } from "@renderer/context";

const TORBOX_API_TOKEN_URL = "https://torbox.app/settings";

export function SettingsTorBox() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { updateUserPreferences } = useContext(settingsContext);

  const [isLoading, setIsLoading] = useState(false);
  const [form, setForm] = useState({
    useTorBox: false,
    torboxApiToken: null as string | null,
  });

  const { showSuccessToast, showErrorToast } = useToast();

  const { t } = useTranslation("settings");

  useEffect(() => {
    if (userPreferences) {
      setForm({
        useTorBox: Boolean(userPreferences.torboxApiToken),
        torboxApiToken: userPreferences.torboxApiToken ?? null,
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
          form.torboxApiToken!
        );

        showSuccessToast(t("torbox_linked_message", { email: user.email }));
      } else {
        showSuccessToast(t("changes_saved"));
      }

      updateUserPreferences({
        torboxApiToken: form.useTorBox ? form.torboxApiToken : null,
      });
    } catch (err) {
      console.error(err);
      showErrorToast(t("torbox_invalid_token"));
    } finally {
      setIsLoading(false);
    }
  };

  const isButtonDisabled =
    (form.useTorBox && !form.torboxApiToken) || isLoading;

  return (
    <form className={styles.form} onSubmit={handleFormSubmit}>
      <p className={styles.description}>{t("torbox_description")}</p>

      <CheckboxField
        label={t("enable_torbox")}
        checked={form.useTorBox}
        onChange={() =>
          setForm((prev) => ({
            ...prev,
            useTorBox: !form.useTorBox,
          }))
        }
      />

      {form.useTorBox && (
        <TextField
          label={t("torbox_api_token")}
          value={form.torboxApiToken ?? ""}
          type="password"
          onChange={(event) =>
            setForm({ ...form, torboxApiToken: event.target.value })
          }
          placeholder="API Token"
          containerProps={{ style: { marginTop: `${SPACING_UNIT}px` } }}
          hint={
            <Trans i18nKey="torbox_api_token_hint" ns="settings">
              <Link to={TORBOX_API_TOKEN_URL} />
            </Trans>
          }
        />
      )}

      <Button
        type="submit"
        style={{ alignSelf: "flex-end", marginTop: `${SPACING_UNIT * 2}px` }}
        disabled={isButtonDisabled}
      >
        {t("save_changes")}
      </Button>
    </form>
  );
}
