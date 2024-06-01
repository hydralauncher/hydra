import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { SyncIcon } from "@primer/octicons-react";

import * as styles from "./header.css";
import { AppUpdaterEvents } from "@types";
import { Link } from "../link/link";

export const releasesPageUrl =
  "https://github.com/hydralauncher/hydra/releases";

const isMac = window.electron.platform === "darwin";

export function AutoUpdateSubHeader() {
  const [showUpdateSubheader, setShowUpdateSubheader] = useState(false);
  const [newVersion, setNewVersion] = useState("");

  const { t } = useTranslation("header");

  const handleClickNewUpdate = () => {
    window.electron.restartAndInstallUpdate();
  };

  useEffect(() => {
    const unsubscribe = window.electron.onAutoUpdaterEvent(
      (event: AppUpdaterEvents) => {
        if (event.type == "update-available") {
          setNewVersion(event.info.version || "");

          if (isMac) {
            setShowUpdateSubheader(true);
          }
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

  if (!showUpdateSubheader) return null;

  return (
    <header className={styles.subheader}>
      {isMac ? (
        <Link to={releasesPageUrl} className={styles.newVersionLink}>
          <SyncIcon size={12} />
          <small>
            {t("version_available_download", { version: newVersion })}
          </small>
        </Link>
      ) : (
        <button
          type="button"
          className={styles.newVersionButton}
          onClick={handleClickNewUpdate}
        >
          <SyncIcon size={12} />
          <small>
            {t("version_available_install", { version: newVersion })}
          </small>
        </button>
      )}
    </header>
  );
}
