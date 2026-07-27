import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CloudIcon } from "@primer/octicons-react";
import { SettingsYandexDisk } from "./settings-yandex-disk";
import { CloudBackupsManager } from "./cloud-backups-manager";
import "./settings-cloud-storage.scss";

export function SettingsContextCloudStorage() {
  const { t } = useTranslation("settings");
  const [connected, setConnected] = useState(false);

  return (
    <div className="settings-cloud-storage">
      <div className="settings-cloud-storage__section">
        <SettingsYandexDisk onConnectionChange={setConnected} />
      </div>

      {connected ? (
        <>
          <hr className="settings-cloud-storage__divider" />

          <div className="settings-cloud-storage__section">
            <h3 className="settings-cloud-storage__section-title">
              {t("cloud_storage_backups_title", "Облачные резервные копии")}
            </h3>
            <CloudBackupsManager connected={connected} />
          </div>
        </>
      ) : (
        <div className="settings-cloud-storage__disconnected">
          <CloudIcon size={32} />
          <p>
            {t(
              "cloud_storage_not_connected",
              "Яндекс.Диск не подключён. Подключите аккаунт Яндекс.Диска для использования облачных резервных копий."
            )}
          </p>
        </div>
      )}
    </div>
  );
}
