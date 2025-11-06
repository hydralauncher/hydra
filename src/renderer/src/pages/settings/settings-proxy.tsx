import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TextField, SelectField, Button } from "@renderer/components";
import { useAppSelector } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import type { ProxyConfig, ProxyMode, ProxyProtocol } from "@types";
import "./settings-proxy.scss";

export function SettingsProxy() {
  const { t } = useTranslation("settings");

  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [systemProxy, setSystemProxy] = useState<{
    host: string;
    port: number;
  } | null>(null);

  const [form, setForm] = useState<ProxyConfig>({
    mode: "direct",
    protocol: "http",
    host: "",
    port: 8080,
    username: "",
    password: "",
  });

  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    // Load system proxy info
    window.electron.getSystemProxy().then((proxy) => {
      setSystemProxy(proxy);
    });

    // Load saved proxy config
    if (userPreferences?.proxyConfig) {
      setForm((prev) => ({
        ...prev,
        ...userPreferences.proxyConfig,
      }));
    }
  }, [userPreferences]);

  const handleModeChange = async (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const mode = event.target.value as ProxyMode;
    const newConfig = { ...form, mode };
    setForm(newConfig);
    await updateUserPreferences({ proxyConfig: newConfig });
    setTestResult(null);
  };

  const handleProtocolChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const protocol = event.target.value as ProxyProtocol;
    setForm((prev) => ({ ...prev, protocol }));
    setTestResult(null);
  };

  const handleInputChange = (field: keyof ProxyConfig, value: string) => {
    setForm((prev) => ({
      ...prev,
      [field]: field === "port" ? parseInt(value) || 0 : value,
    }));
    setTestResult(null);
  };

  const handleSave = async () => {
    await updateUserPreferences({ proxyConfig: form });
    setTestResult({
      success: true,
      message: t("proxy_settings_saved"),
    });
  };

  const proxyModeOptions = [
    { key: "direct", value: "direct", label: t("proxy_mode_direct") },
    { key: "system", value: "system", label: t("proxy_mode_system") },
    { key: "manual", value: "manual", label: t("proxy_mode_manual") },
  ];

  const proxyProtocolOptions = [
    { key: "http", value: "http", label: "HTTP" },
    { key: "socks5", value: "socks5", label: "SOCKS5" },
    { key: "socks4", value: "socks4", label: "SOCKS4" },
  ];

  return (
    <div className="settings-proxy">
      <SelectField
        label={t("proxy_mode")}
        value={form.mode}
        onChange={handleModeChange}
        options={proxyModeOptions}
      />

      {form.mode === "system" && systemProxy && (
        <div className="settings-proxy__system-info">
          <p>
            {t("system_proxy_detected")}: {systemProxy.host}:{systemProxy.port}
          </p>
        </div>
      )}

      {form.mode === "system" && !systemProxy && (
        <div className="settings-proxy__system-info settings-proxy__system-info--warning">
          <p>{t("no_system_proxy_detected")}</p>
        </div>
      )}

      {form.mode === "manual" && (
        <>
          <SelectField
            label={t("proxy_protocol")}
            value={form.protocol}
            onChange={handleProtocolChange}
            options={proxyProtocolOptions}
          />

          <TextField
            label={t("proxy_host")}
            value={form.host}
            onChange={(e) => handleInputChange("host", e.target.value)}
            placeholder="127.0.0.1"
          />

          <TextField
            label={t("proxy_port")}
            value={form.port?.toString() || ""}
            onChange={(e) => handleInputChange("port", e.target.value)}
            type="number"
            placeholder="8080"
          />

          <h3 className="settings-proxy__section-title">
            {t("proxy_authentication")}
          </h3>
          <p className="settings-proxy__hint">{t("proxy_auth_optional")}</p>

          <TextField
            label={t("proxy_username")}
            value={form.username || ""}
            onChange={(e) => handleInputChange("username", e.target.value)}
            placeholder={t("optional")}
          />

          <TextField
            label={t("proxy_password")}
            value={form.password || ""}
            onChange={(e) => handleInputChange("password", e.target.value)}
            type="password"
            placeholder={t("optional")}
          />

          <div className="settings-proxy__actions">
            <Button theme="outline" onClick={handleSave}>
              {t("save")}
            </Button>
          </div>

          {testResult && (
            <div
              className={`settings-proxy__test-result ${
                testResult.success
                  ? "settings-proxy__test-result--success"
                  : "settings-proxy__test-result--error"
              }`}
            >
              {testResult.message}
            </div>
          )}
        </>
      )}

      <div className="settings-proxy__info">
        <h3>{t("proxy_info_title")}</h3>
        <ul>
          <li>{t("proxy_info_direct")}</li>
          <li>{t("proxy_info_system")}</li>
          <li>{t("proxy_info_manual")}</li>
        </ul>
      </div>
    </div>
  );
}
