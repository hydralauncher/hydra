import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Button, CheckboxField, Link, TextField } from "@renderer/components";
import * as styles from "./settings-real-debrid.css";
import type { UserPreferences } from "@types";
import { SPACING_UNIT } from "@renderer/theme.css";

const REAL_DEBRID_API_TOKEN_URL = "https://real-debrid.com/apitoken";

export interface SettingsRealDebridProps {
  userPreferences: UserPreferences | null;
  updateUserPreferences: (values: Partial<UserPreferences>) => void;
}

export function SettingsRealDebrid({
  userPreferences,
  updateUserPreferences,
}: SettingsRealDebridProps) {
  const [form, setForm] = useState({
    useRealDebrid: false,
    realDebridApiToken: null as string | null,
  });

  const { t } = useTranslation("settings");

  useEffect(() => {
    if (userPreferences) {
      setForm({
        useRealDebrid: Boolean(userPreferences.realDebridApiToken),
        realDebridApiToken: userPreferences.realDebridApiToken ?? null,
      });
    }
  }, [userPreferences]);

  const handleFormSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    updateUserPreferences({
      realDebridApiToken: form.useRealDebrid ? form.realDebridApiToken : null,
    });
  };

  const isButtonDisabled = form.useRealDebrid && !form.realDebridApiToken;

  return (
    <form className={styles.form} onSubmit={handleFormSubmit}>
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
          label={t("real_debrid_api_token_description")}
          value={form.realDebridApiToken ?? ""}
          type="password"
          onChange={(event) =>
            setForm({ ...form, realDebridApiToken: event.target.value })
          }
          placeholder="API Token"
          containerProps={{ style: { marginTop: `${SPACING_UNIT}px` } }}
          hint={
            <Trans i18nKey="real_debrid_api_token_hint" ns="settings">
              <Link to={REAL_DEBRID_API_TOKEN_URL} />
            </Trans>
          }
        />
      )}

      <Button
        type="submit"
        style={{ alignSelf: "flex-end" }}
        disabled={isButtonDisabled}
      >
        Save changes
      </Button>
    </form>
  );
}
