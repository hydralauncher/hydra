import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector, useToast } from "@renderer/hooks";

const isValidServerUrl = (value: string) => {
  if (!value) return true;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export function SettingsSelfHosted() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();
  const { t } = useTranslation("settings");

  const [cloudUrl, setCloudUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setCloudUrl(userPreferences?.selfHostedCloudUrl ?? "");
  }, [userPreferences?.selfHostedCloudUrl]);

  const hasChanges =
    cloudUrl.trim() !== (userPreferences?.selfHostedCloudUrl ?? "");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const normalizedUrl = cloudUrl.trim().replace(/\/+$/, "");

    if (!isValidServerUrl(normalizedUrl)) {
      showErrorToast(t("self_hosted_invalid_url"));
      return;
    }

    setIsSubmitting(true);

    try {
      await updateUserPreferences({
        selfHostedCloudUrl: normalizedUrl || null,
      });

      showSuccessToast(t("self_hosted_saved"));
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <p>{t("self_hosted_description")}</p>

      <TextField
        label={t("self_hosted_server_url")}
        value={cloudUrl}
        placeholder="https://hydra-cloud.example.com"
        onChange={(event) => setCloudUrl(event.target.value)}
        hint={t("self_hosted_server_url_hint")}
        rightContent={
          <Button type="submit" disabled={isSubmitting || !hasChanges}>
            {t("save_changes")}
          </Button>
        }
      />
    </form>
  );
}
