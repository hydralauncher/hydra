import { useContext, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Button, CheckboxField, Link, TextField } from "@renderer/components";
import * as styles from "./settings-debrid.css";

import { useAppSelector, useToast } from "@renderer/hooks";

import { SPACING_UNIT } from "@renderer/theme.css";
import { settingsContext } from "@renderer/context";

const REAL_DEBRID_API_TOKEN_URL = "https://real-debrid.com/apitoken";
const TORBOX_API_TOKEN_URL = "https://torbox.app/settings";

export function SettingsDebrid() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { updateUserPreferences } = useContext(settingsContext);

  const [isLoading, setIsLoading] = useState(false);
  const [form, setForm] = useState({
    useRealDebrid: false,
    realDebridApiToken: null as string | null,
    useTorBox: false,
    torBoxApiToken: null as string | null,
  });

  const { showSuccessToast, showErrorToast } = useToast();

  const { t } = useTranslation("settings");

  useEffect(() => {
    if (userPreferences) {
      setForm({
        useRealDebrid: Boolean(userPreferences.realDebridApiToken),
        realDebridApiToken: userPreferences.realDebridApiToken ?? null,
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
            t("real_debrid_linked_message", { username: user.username })
          );
        }
      } else {
        showSuccessToast(t("changes_saved"));
      }

      updateUserPreferences({
        realDebridApiToken: form.useRealDebrid ? form.realDebridApiToken : null,
        torBoxApiToken: form.useTorBox ? form.torBoxApiToken : null,
      });
    } catch (err) {
      showErrorToast(t("real_debrid_invalid_token"));
    } finally {
      setIsLoading(false);
    }
  };

  const isButtonDisabled =
    (form.useRealDebrid && !form.realDebridApiToken) || isLoading;

  return (
    <form className={styles.form} onSubmit={handleFormSubmit}>
      <p className={styles.description}>{t("real_debrid_description")}</p>

      <CheckboxField
        label={t("enable_real_debrid")}
        checked={form.useRealDebrid}
        onChange={() =>
          setForm((prev) => ({
            ...prev,
            useRealDebrid: !form.useRealDebrid,
          }))
        }
      />

      {form.useRealDebrid && (
        <TextField
          label={t("real_debrid_api_token")}
          value={form.realDebridApiToken ?? ""}
          type="password"
          onChange={(event) =>
            setForm({ ...form, realDebridApiToken: event.target.value })
          }
          placeholder="API Token"
          containerProps={{ style: { marginTop: `${SPACING_UNIT}px` } }}
          rightContent={
            <Button
              type="submit"
              style={{
                alignSelf: "flex-end",
              }}
              disabled={isButtonDisabled}
            >
              {t("save")}
            </Button>
          }
          hint={
            <Trans i18nKey="real_debrid_api_token_hint" ns="settings">
              <Link to={REAL_DEBRID_API_TOKEN_URL} />
            </Trans>
          }
        />
      )}

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
          label={t("real_debrid_api_token")}
          value={form.torBoxApiToken ?? ""}
          type="password"
          onChange={(event) =>
            setForm({ ...form, torBoxApiToken: event.target.value })
          }
          placeholder="API Token"
          containerProps={{ style: { marginTop: `${SPACING_UNIT}px` } }}
          rightContent={
            <Button
              type="submit"
              style={{
                alignSelf: "flex-end",
              }}
              disabled={isButtonDisabled}
            >
              {t("save")}
            </Button>
          }
          hint={
            <Trans i18nKey="real_debrid_api_token_hint" ns="settings">
              <Link to={TORBOX_API_TOKEN_URL} />
            </Trans>
          }
        />
      )}
    </form>
  );
}
