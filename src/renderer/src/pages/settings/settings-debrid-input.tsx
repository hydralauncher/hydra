import { useContext, useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button, CheckboxField, Link, TextField } from "@renderer/components";
import * as styles from "./settings-debrid.css";
import { useAppSelector, useToast } from "@renderer/hooks";
import { SPACING_UNIT } from "@renderer/theme.css";
import { settingsContext } from "@renderer/context";
import { DebridServices } from "@types";

const REAL_DEBRID_API_TOKEN_URL = "https://real-debrid.com/apitoken";
const TORBOX_API_TOKEN_URL = "https://torbox.app/settings";

interface SettingsDebridForm {
  useRealDebrid: boolean;
  realDebridApiToken: string | null;
  useTorBox: boolean;
  torBoxApiToken: string | null;
}

export interface SettingsDebridProps {
  service: DebridServices;
  form: SettingsDebridForm;
  setForm: (SettingsDebridForm) => void;
}

export function SettingsDebridInput({
  service,
  form,
  setForm,
}: SettingsDebridProps) {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { updateUserPreferences } = useContext(settingsContext);

  const [isLoading, setIsLoading] = useState(false);

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
      });
    } catch (err) {
      showErrorToast(t("real_debrid_invalid_token"));
    } finally {
      setIsLoading(false);
    }
  };

  const useDebridService = useMemo(() => {
    if (service === "RealDebrid") {
      return form.useRealDebrid;
    }

    if (service === "TorBox") {
      return form.useTorBox;
    }

    return false;
  }, [form, service]);

  const debridApiToken = useMemo(() => {
    if (service === "RealDebrid") {
      return form.realDebridApiToken;
    }

    if (service === "TorBox") {
      return form.torBoxApiToken;
    }

    return null;
  }, [form, service]);

  const onChangeCheckbox = () => {
    if (service === "RealDebrid") {
      setForm((prev) => ({
        ...prev,
        useRealDebrid: !form.useRealDebrid,
      }));
    }

    if (service === "TorBox") {
      setForm((prev) => ({
        ...prev,
        useTorBox: !form.useTorBox,
      }));
    }
  };

  const onChangeInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (service === "RealDebrid") {
      setForm((prev) => ({
        ...prev,
        realDebridApiToken: event.target.value,
      }));
    }

    if (service === "TorBox") {
      setForm((prev) => ({
        ...prev,
        torBoxApiToken: event.target.value,
      }));
    }
  };

  const isButtonDisabled =
    (form.useRealDebrid && !form.realDebridApiToken) || isLoading;

  return (
    <form className={styles.form} onSubmit={handleFormSubmit}>
      <CheckboxField
        label={t("enable_real_debrid")}
        checked={useDebridService}
        onChange={onChangeCheckbox}
      />

      {useDebridService && (
        <TextField
          label={t("real_debrid_api_token")}
          value={debridApiToken ?? ""}
          type="password"
          onChange={onChangeInput}
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
    </form>
  );
}
