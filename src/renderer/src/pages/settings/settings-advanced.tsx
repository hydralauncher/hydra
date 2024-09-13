import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, CheckboxField, TextField } from "@renderer/components";
import * as styles from "./settings-advanced.css";
import { useAppSelector } from "@renderer/hooks";
import { SPACING_UNIT } from "@renderer/theme.css";
import { settingsContext } from "@renderer/context";

export function SettingsAdvanced() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const userClientPreferences = useAppSelector(
    (state) => state.userClientPreferences.value
  );

  const { updateUserPreferences } = useContext(settingsContext);
  const { updateUserClientPreferences } = useContext(settingsContext);

  const [isLoading, setIsLoading] = useState(false);
  const [form, setForm] = useState({
    useExternalClient: false,
    clientType: null as string | null,
    clientHost: null as string | null,
    clientPort: null as number | null,
    clientUsername: null as string | null,
    clientPassword: null as string | null,
  });

  const { t } = useTranslation("settings");

  useEffect(() => {
    if (userPreferences) {
      setForm({
        useExternalClient: userPreferences.useExternalClient,
        clientType: userClientPreferences
          ? userClientPreferences.clientType
          : null,
        clientHost: userClientPreferences
          ? userClientPreferences.clientHost
          : null,
        clientPort: userClientPreferences
          ? Number(userClientPreferences.clientPort)
          : null,
        clientUsername: userClientPreferences
          ? userClientPreferences.clientUsername
          : null,
        clientPassword: userClientPreferences
          ? userClientPreferences.clientPassword
          : null,
      });
    }
  }, [userPreferences, userClientPreferences]);

  const handleFormSubmit: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    setIsLoading(true);
    event.preventDefault();

    if (form.useExternalClient) {
      updateUserClientPreferences({
        clientType: form.clientType,
        clientHost: form.clientHost,
        clientPort: String(form.clientPort),
        clientUsername: form.clientUsername,
        clientPassword: form.clientPassword,
      });
    }
    updateUserPreferences({
      useExternalClient: form.useExternalClient,
    });
    setIsLoading(false);
  };

  const isButtonDisabled =
    (form.useExternalClient &&
      !form.useExternalClient &&
      !form.clientHost &&
      !form.clientPort &&
      !form.clientUsername &&
      !form.clientPassword &&
      !form.clientType) ||
    isLoading;

  return (
    <form className={styles.form} onSubmit={handleFormSubmit}>
      <p className={styles.description}>{t("advanced-description")}</p>

      <CheckboxField
        label={t("enable_client")}
        checked={form.useExternalClient}
        onChange={() =>
          setForm((prev) => ({
            ...prev,
            useExternalClient: !form.useExternalClient,
          }))
        }
      />

      <div>
        <datalist id="torrentLists">
          <option value="qbittorrent">Qbittorrent</option>
        </datalist>
      </div>

      {form.useExternalClient && (
        <TextField
          list="torrentLists"
          label={t("client_type")}
          value={form.clientType ?? ""}
          type="text"
          onChange={(event) =>
            setForm({ ...form, clientType: event.target.value })
          }
          placeholder="Client Type"
          containerProps={{ style: { marginTop: `${SPACING_UNIT}px` } }}
        />
      )}

      {form.useExternalClient && (
        <TextField
          label={t("client_host")}
          value={form.clientHost ?? ""}
          type="text"
          onChange={(event) =>
            setForm({ ...form, clientHost: event.target.value })
          }
          placeholder="Client Host"
          containerProps={{ style: { marginTop: `${SPACING_UNIT}px` } }}
        />
      )}
      {form.useExternalClient && (
        <TextField
          label={t("client_port")}
          value={form.clientPort ?? ""}
          type="text"
          onChange={(event) =>
            (function () {
              if (Number(event.target.value)) {
                setForm({ ...form, clientPort: Number(event.target.value) });
              }
            })()
          }
          placeholder="Client Port"
          containerProps={{ style: { marginTop: `${SPACING_UNIT}px` } }}
        />
      )}
      {form.useExternalClient && (
        <TextField
          label={t("client_username")}
          value={form.clientUsername ?? ""}
          type="text"
          onChange={(event) =>
            setForm({ ...form, clientUsername: event.target.value })
          }
          placeholder="Client Username"
          containerProps={{ style: { marginTop: `${SPACING_UNIT}px` } }}
        />
      )}
      {form.useExternalClient && (
        <TextField
          label={t("client_password")}
          value={form.clientPassword ?? ""}
          type="password"
          onChange={(event) =>
            setForm({ ...form, clientPassword: event.target.value })
          }
          placeholder="Warning: Stored in Plain text on machine"
          containerProps={{ style: { marginTop: `${SPACING_UNIT}px` } }}
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
