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
        console.log("event from screen: " + event.type);
        setStatus(event);
        switch (event.type) {
          case "download-progress":
            console.log(event.info);
            break;
          case "checking-for-updates":
            break;
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
            <p>Baixando atualização {newVersion}</p>
            <p>{status.info.percent.toFixed(2)} %</p>
          </>
        );
      case "checking-for-updates":
        return <p>Buscando atualizações</p>;
      case "update-available":
        return <p>Atualização {status.info.version} encontrada</p>;
      default:
        return <></>;
    }
  };

  return (
    <main className={styles.main}>
      <img src={icon} className={styles.splashIcon} alt="" />
      {renderSwitch()}
    </main>
  );
}
