import icon from "@renderer/assets/icon.png";
import * as styles from "./splash.css";
import { themeClass } from "../../theme.css";

import "../../app.css";
import { useEffect, useState } from "react";
import { AppUpdaterEvents } from "@types";

document.body.classList.add(themeClass);

export default function Splash() {
  const [status, setStatus] = useState<AppUpdaterEvents | null>(null);
  const [newVersion, setNewVersion] = useState("");

  useEffect(() => {
    console.log("subscribing");
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

  const renderSwitch = () => {
    switch (status?.type) {
      case "download-progress":
        return (
          <>
            <p>Baixando versão {newVersion}</p>
            <div className={styles.progressBarContainer}>
              <div
                className={styles.progressBarFill}
                style={{ width: `${status.info.percent}%` }}
              ></div>
              <span className={styles.progressBarText}>
                {status.info.percent.toFixed(2)} %
              </span>
            </div>
          </>
        );
      case "checking-for-updates":
        return <p>Buscando atualizações</p>;
      case "update-available":
        return <p>Versão {status.info.version} encontrada</p>;
      case "update-downloaded":
        return <p>Reiniciando e aplicando atualização</p>;
      default:
        return <></>;
    }
  };

  return (
    <main className={styles.main}>
      <img src={icon} className={styles.splashIcon} alt="Hydra Logo" />
      <section className={styles.updateInfoSection}>{renderSwitch()}</section>
    </main>
  );
}
