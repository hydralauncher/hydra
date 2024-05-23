import icon from "@renderer/assets/icon.png";
import * as styles from "./splash.css";
import { themeClass } from "../../theme.css";

import "../../app.css";
import { useEffect, useState } from "react";
import { AppUpdaterEvents } from "@types";
import { useTranslation } from "react-i18next";

document.body.classList.add(themeClass);

export default function Splash() {
  const [status, setStatus] = useState<AppUpdaterEvents | null>(null);
  const [newVersion, setNewVersion] = useState("");

  const { t } = useTranslation("splash");

  useEffect(() => {
    const unsubscribe = window.electron.onAutoUpdaterEvent(
      (event: AppUpdaterEvents) => {
        setStatus(event);

        switch (event.type) {
          case "error":
            window.electron.continueToMainWindow();
            break;
          case "update-available":
            setNewVersion(event.info.version);
            break;
          case "update-cancelled":
            window.electron.continueToMainWindow();
            break;
          case "update-downloaded":
            window.electron.restartAndInstallUpdate();
            break;
          case "update-not-available":
            window.electron.continueToMainWindow();
            break;
        }
      }
    );

    window.electron.checkForUpdates();

    return () => {
      unsubscribe();
    };
  }, []);

  const renderUpdateInfo = () => {
    switch (status?.type) {
      case "download-progress":
        return (
          <>
            <p>{t("downloading_version", { version: newVersion })}</p>
            <progress
              className={styles.progressBar}
              max="100"
              value={status.info.percent}
            />
          </>
        );
      case "checking-for-updates":
        return <p>{t("searching_updates")}</p>;
      case "update-available":
        return <p>{t("update_found", { version: newVersion })}</p>;
      case "update-downloaded":
        return <p>{t("restarting_and_applying")}</p>;
      default:
        return <></>;
    }
  };

  return (
    <main className={styles.main}>
      <img src={icon} className={styles.splashIcon} alt="Hydra Launcher Logo" />
      <section className={styles.updateInfoSection}>
        {renderUpdateInfo()}
      </section>
    </main>
  );
}
