import { useTranslation } from "react-i18next";
import { DashIcon, XIcon } from "@primer/octicons-react";

import "./auth-window.scss";

const electron = globalThis.electron as Electron;

export default function AuthWindow() {
  const { t } = useTranslation("header");

  return (
    <div className="auth-window">
      <header className="auth-window__title-bar">
        <h4>Hydra</h4>
        <div className="auth-window__window-controls">
          <button
            type="button"
            className="auth-window__window-control"
            onClick={() => electron.minimizeAuthWindow()}
            title={t("minimize")}
            aria-label={t("minimize")}
          >
            <DashIcon size={16} />
          </button>
          <button
            type="button"
            className="auth-window__window-control auth-window__window-control--close"
            onClick={() => electron.closeAuthWindow()}
            title={t("close")}
            aria-label={t("close")}
          >
            <XIcon size={16} />
          </button>
        </div>
      </header>
    </div>
  );
}
