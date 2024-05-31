import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { SyncIcon } from "@primer/octicons-react";

import * as styles from "./header.css";
import { AppUpdaterEvents } from "@types";

export function AutoUpdateSubHeader() {
  const [showUpdateSubheader, setShowUpdateSubheader] = useState(false);
  const [newVersion, setNewVersion] = useState("");
  const [newVersionText, setNewVersionText] = useState("");

  const { t } = useTranslation("header");

  const handleClickNewUpdate = () => {
    window.electron.restartAndInstallUpdate();
  };

  useEffect(() => {
    if (window.electron.platform == "darwin") {
      setNewVersionText(
        t("version_available_download", { version: newVersion })
      );
    } else {
      setNewVersionText(
        t("version_available_install", { version: newVersion })
      );
    }
  }, [t, newVersion]);

  useEffect(() => {
    const unsubscribe = window.electron.onAutoUpdaterEvent(
      (event: AppUpdaterEvents) => {
        if (event.type == "update-available") {
          setNewVersion(event.info.version || "");
        }

        if (event.type == "update-downloaded") {
          setShowUpdateSubheader(true);
        }
      }
    );

    window.electron.checkForUpdates();

    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <>
      {showUpdateSubheader && (
        <header className={styles.subheader}>
          <button
            type="button"
            className={styles.newVersionButton}
            onClick={handleClickNewUpdate}
          >
            <SyncIcon size={12} />
            <small>{newVersionText}</small>
          </button>
        </header>
      )}
    </>
  );
}
