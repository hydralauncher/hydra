import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircleFillIcon, XCircleFillIcon } from "@primer/octicons-react";
import { Button, CheckboxField, TextField } from "@renderer/components";
import "./settings-yandex-disk.scss";
import { useToast } from "@renderer/hooks";

interface Props {
  /** Called whenever the connection state changes (connected/disconnected). */
  onConnectionChange?: (connected: boolean) => void;
}

export function SettingsYandexDisk({ onConnectionChange }: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();

  const [settings, setSettings] = useState<YandexDiskSettings>({
    token: null,
    backupEnabled: false,
    restoreOnStartup: false,
    maxBackups: 5,
  });

  const [account, setAccount] = useState<{
    login: string | null;
    displayName: string | null;
  } | null>(null);

  const [tokenInput, setTokenInput] = useState("");
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const isConnected = Boolean(settings.token);

  const loadSettings = async () => {
    const s = await window.electron.getYandexDiskSettings();
    setSettings(s);
    setTokenInput(s.token ?? "");

    if (s.token) {
      const accountInfo = await window.electron.getYandexDiskAccountInfo();
      setAccount(accountInfo);
    } else {
      setAccount(null);
    }
  };

  useEffect(() => {
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onConnectionChange?.(isConnected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  const handleValidateToken = async () => {
    if (!tokenInput.trim()) return;
    setIsValidating(true);
    try {
      const valid = await window.electron.validateYandexDiskToken(
        tokenInput.trim()
      );
      if (valid) {
        await window.electron.updateYandexDiskSettings({
          token: tokenInput.trim(),
        });
        showSuccessToast(t("yandex_disk_token_valid", "Токен действителен"));
        setIsReconnecting(false);
        await loadSettings();
      } else {
        showErrorToast(t("yandex_disk_token_invalid", "Токен недействителен"));
      }
    } catch {
      showErrorToast(
        t("yandex_disk_token_invalid_generic", "Ошибка проверки токена")
      );
    } finally {
      setIsValidating(false);
    }
  };

  const handleDisconnect = async () => {
    setIsSaving(true);
    try {
      await window.electron.updateYandexDiskSettings({ token: null });
      setTokenInput("");
      showSuccessToast(t("yandex_disk_disconnected", "Яндекс.Диск отключён"));
      await loadSettings();
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleBackup = async (enabled: boolean) => {
    setIsSaving(true);
    try {
      await window.electron.updateYandexDiskSettings({
        backupEnabled: enabled,
      });
      setSettings((s) => ({ ...s, backupEnabled: enabled }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleRestore = async (enabled: boolean) => {
    setIsSaving(true);
    try {
      await window.electron.updateYandexDiskSettings({
        restoreOnStartup: enabled,
      });
      setSettings((s) => ({ ...s, restoreOnStartup: enabled }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleMaxBackupsChange = async (value: string) => {
    const n = Math.max(1, Math.min(20, parseInt(value, 10) || 5));
    setSettings((s) => ({ ...s, maxBackups: n }));
    await window.electron.updateYandexDiskSettings({ maxBackups: n });
  };

  const showTokenForm = !isConnected || isReconnecting;

  return (
    <div className="settings-yandex-disk">
      <div className="settings-yandex-disk__status-row">
        <div className="settings-yandex-disk__status">
          {isConnected ? (
            <CheckCircleFillIcon
              size={16}
              className="settings-yandex-disk__status-icon settings-yandex-disk__status-icon--connected"
            />
          ) : (
            <XCircleFillIcon
              size={16}
              className="settings-yandex-disk__status-icon settings-yandex-disk__status-icon--disconnected"
            />
          )}
          <span>
            {isConnected
              ? t("yandex_disk_connected", "Подключено")
              : t("yandex_disk_not_connected", "Не подключено")}
          </span>
        </div>

        {isConnected && (
          <div className="settings-yandex-disk__actions">
            <Button
              theme="outline"
              onClick={() => setIsReconnecting((v) => !v)}
              disabled={isSaving}
            >
              {t("yandex_disk_reconnect", "Переподключить")}
            </Button>
            <Button
              theme="outline"
              onClick={handleDisconnect}
              disabled={isSaving}
            >
              {t("yandex_disk_disconnect", "Отключить")}
            </Button>
          </div>
        )}
      </div>

      {isConnected && (account?.login || account?.displayName) && (
        <p className="settings-yandex-disk__account">
          {t("yandex_disk_account", "Аккаунт")}:{" "}
          {account.displayName || account.login}
        </p>
      )}

      <p className="settings-yandex-disk__description">
        {t(
          "yandex_disk_description",
          "Автоматический бекап сохранений и достижений на Яндекс Диск при выходе из игры."
        )}
      </p>

      {showTokenForm && (
        <div className="settings-yandex-disk__form">
          <div className="settings-yandex-disk__token-row">
            <TextField
              label={t("yandex_disk_token_label", "OAuth-токен")}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="y0_XXXX..."
              type="password"
            />
            <Button
              theme="outline"
              onClick={handleValidateToken}
              disabled={isValidating || !tokenInput.trim()}
            >
              {isValidating
                ? t("yandex_disk_validating", "Проверяю...")
                : t("yandex_disk_validate", "Проверить токен")}
            </Button>
          </div>

          <p className="settings-yandex-disk__token-hint">
            {t(
              "yandex_disk_token_hint",
              "Получите токен на oauth.yandex.ru. Платформа: Веб-сервисы. Права: Яндекс Диск → Запись + Чтение."
            )}
          </p>
        </div>
      )}

      {isConnected && (
        <div className="settings-yandex-disk__form">
          <CheckboxField
            label={t(
              "yandex_disk_enable_backup",
              "Включить автобекап при выходе из игры"
            )}
            checked={settings.backupEnabled}
            onChange={(e) => handleToggleBackup(e.target.checked)}
            disabled={isSaving}
          />

          <CheckboxField
            label={t(
              "yandex_disk_restore_on_startup",
              "Восстанавливать при запуске Hydra (если нет локальных)"
            )}
            checked={settings.restoreOnStartup}
            onChange={(e) => handleToggleRestore(e.target.checked)}
            disabled={isSaving}
          />

          <div className="settings-yandex-disk__max-backups">
            <label className="settings-yandex-disk__max-backups-label">
              {t("yandex_disk_max_backups", "Максимум бекапов на диске (1-20)")}
            </label>
            <input
              className="settings-yandex-disk__max-backups-input"
              type="number"
              min={1}
              max={20}
              value={settings.maxBackups}
              onChange={(e) => handleMaxBackupsChange(e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
