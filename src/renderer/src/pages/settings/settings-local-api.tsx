import { useContext, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { CopyIcon, SyncIcon } from "@primer/octicons-react";

import type { UserPreferences } from "@types";
import { Button, CheckboxField, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector, useToast } from "@renderer/hooks";

import "./settings-local-api.scss";

const LOCAL_API_DEFAULT_PORT = 17577;
const LOCAL_API_MIN_PORT = 1;
const LOCAL_API_MAX_PORT = 65535;

export function SettingsLocalApi() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const enabled = userPreferences?.localApiEnabled ?? false;
  const bindLan = userPreferences?.localApiBindLan ?? false;
  const port = userPreferences?.localApiPort || LOCAL_API_DEFAULT_PORT;
  const token = userPreferences?.localApiToken ?? "";

  const [portDraft, setPortDraft] = useState(() => String(port));
  const [lanAddress, setLanAddress] = useState<string | null>(null);

  useEffect(() => {
    setPortDraft(String(port));
  }, [port]);

  useEffect(() => {
    if (!bindLan) {
      setLanAddress(null);
      return;
    }

    window.electron
      .getNetworkInterfaces()
      .then((interfaces) => {
        setLanAddress(interfaces[0]?.addresses[0] ?? null);
      })
      .catch(() => setLanAddress(null));
  }, [bindLan]);

  const savePreferences = async (values: Partial<UserPreferences>) => {
    try {
      await updateUserPreferences(values);
    } catch {
      showErrorToast(t("local_api_start_failed"));
    }
  };

  const commitPort = () => {
    const parsed = Number.parseInt(portDraft, 10);
    const nextPort =
      Number.isInteger(parsed) &&
      parsed >= LOCAL_API_MIN_PORT &&
      parsed <= LOCAL_API_MAX_PORT
        ? parsed
        : LOCAL_API_DEFAULT_PORT;

    setPortDraft(String(nextPort));

    if (nextPort !== port) {
      void savePreferences({ localApiPort: nextPort });
    }
  };

  const copyToken = async () => {
    await window.electron.clipboard.writeText(token);
    showSuccessToast(t("local_api_token_copied"));
  };

  const regenerateToken = () => {
    if (!window.confirm(t("local_api_regenerate_confirm"))) return;

    // Main process mints a new token when the stored one is cleared while the
    // API stays enabled.
    void savePreferences({ localApiToken: null });
  };

  // 0.0.0.0 is a bind address, not a reachable one. Show the actual LAN
  // address when known, or a placeholder the user replaces with this PC's IP.
  const displayHost = bindLan ? (lanAddress ?? "<lan-ip>") : "127.0.0.1";
  const baseUrl = `http://${displayHost}:${port}`;
  const gamesEndpoint = `${baseUrl}/api/v1/library/games`;

  const openAddress = (event: React.MouseEvent) => {
    event.preventDefault();
    void window.electron.openExternal(baseUrl);
  };

  const copyExample = async () => {
    await window.electron.clipboard.writeText(`GET ${gamesEndpoint}`);
    showSuccessToast(t("local_api_example_copied"));
  };

  return (
    <div className="settings-local-api">
      <p className="settings-local-api__description">
        {t("local_api_description")}
      </p>

      <div className="settings-local-api__fields">
        <CheckboxField
          label={t("enable_local_api")}
          checked={enabled}
          onChange={() => void savePreferences({ localApiEnabled: !enabled })}
        />

        {enabled && (
          <>
            <TextField
              label={t("local_api_port")}
              type="number"
              min={LOCAL_API_MIN_PORT}
              max={LOCAL_API_MAX_PORT}
              value={portDraft}
              onChange={(event) => setPortDraft(event.target.value)}
              onBlur={commitPort}
            />

            <TextField
              label={t("local_api_token")}
              type="password"
              value={token}
              readOnly
              hint={t("local_api_token_hint")}
              rightContent={
                <>
                  <Button theme="outline" onClick={() => void copyToken()}>
                    <CopyIcon size={14} />
                    {t("local_api_copy_token")}
                  </Button>
                  <Button theme="outline" onClick={regenerateToken}>
                    <SyncIcon size={14} />
                    {t("local_api_regenerate_token")}
                  </Button>
                </>
              }
            />

            <CheckboxField
              label={
                <span className="settings-local-api__hinted-label">
                  {t("local_api_bind_lan")}
                  <small>{t("local_api_bind_lan_hint")}</small>
                </span>
              }
              checked={bindLan}
              onChange={() =>
                void savePreferences({ localApiBindLan: !bindLan })
              }
            />

            <p className="settings-local-api__description">
              <Trans
                i18nKey="local_api_address_hint"
                ns="settings"
                values={{ url: baseUrl }}
                components={{
                  // eslint-disable-next-line jsx-a11y/anchor-has-content -- children are injected by Trans
                  a: <a href={baseUrl} onClick={openAddress} />,
                  code: (
                    <button
                      type="button"
                      className="settings-local-api__example"
                      onClick={() => void copyExample()}
                    />
                  ),
                }}
              />
            </p>
          </>
        )}
      </div>
    </div>
  );
}
