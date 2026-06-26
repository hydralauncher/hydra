import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CheckboxField, TextField } from "@renderer/components";
import { useAppSelector, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";

export function SettingsSelfHosted() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();

  const userPreferences = useAppSelector((state) => state.userPreferences.value);

  const [enabled, setEnabled] = useState(false);
  const [form, setForm] = useState({ url: "", token: "" });
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (userPreferences) {
      setEnabled(Boolean(userPreferences.selfHostedApiUrl) && Boolean(userPreferences.selfHostedApiToken));
      setForm({
        url: userPreferences.selfHostedApiUrl ?? "",
        token: userPreferences.selfHostedApiToken ?? "",
      });
    }
  }, [userPreferences]);

  const handleToggle = async () => {
    const next = !enabled;
    setEnabled(next);
    if (!next) {
      await updateUserPreferences({ selfHostedApiUrl: null, selfHostedApiToken: null, selfHostedUserToken: null });
    }
  };

  const handleSave: React.FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${form.url}/auth/verify-instance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: form.token }),
      });
      if (!res.ok) throw new Error("invalid token");
    } catch {
      showErrorToast("Invalid instance token or server unreachable");
      return;
    }
    await updateUserPreferences({
      selfHostedApiUrl: form.url || null,
      selfHostedApiToken: form.token || null,
    });
    showSuccessToast(t("changes_saved"));
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const result = await window.electron.openHydraCloudImport();
      showSuccessToast(`Imported ${result.imported} games, ${result.achievements} achievements`);
    } catch (err: any) {
      if (err?.message !== "cancelled") showErrorToast("Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <form onSubmit={handleSave}>
      <CheckboxField
        label={t("enable_self_hosted_api")}
        checked={enabled}
        onChange={handleToggle}
      />

      {enabled && (
        <>
          <TextField
            label={t("self_hosted_api_url")}
            value={form.url}
            placeholder="http://localhost:3000"
            onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
          />
          <TextField
            label="Instance token"
            value={form.token}
            type="password"
            placeholder="INSTANCE_TOKEN from .env"
            onChange={(e) => setForm((p) => ({ ...p, token: e.target.value }))}
            rightContent={
              <Button type="submit" disabled={!form.url || !form.token}>
                {t("save_changes")}
              </Button>
            }
          />

          <Button
            type="button"
            disabled={importing}
            onClick={handleImport}
            style={{ marginTop: "16px" }}
          >
            {importing ? "Importing..." : "Import from Hydra Cloud"}
          </Button>
        </>
      )}
    </form>
  );
}
