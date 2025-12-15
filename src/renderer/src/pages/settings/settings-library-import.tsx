import { useEffect } from "react";
import { Button } from "@renderer/components";
import { logger } from "@renderer/logger";
import "./settings-general.scss";

export function SettingsLibraryImport() {
  useEffect(() => {
    const unlisten = window.electron.onSteamLibraryImportProgress(() => {
      // Progress handler
    });

    return () => unlisten();
  }, []);

  const handleImportSteamLibrary = async () => {
    try {
      await window.electron.importSteamLibrary();
    } catch (err) {
      logger.error(err);
    }
  };

  return (
    <div className="settings-general">
      <ul className="settings-download-sources__list">
        <li className={`settings-download-sources__item`}>
          <h2>Steam</h2>
          <Button theme="outline" onClick={() => handleImportSteamLibrary()}>
            Import library
          </Button>
        </li>
      </ul>
    </div>
  );
}
