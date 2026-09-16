import { DashIcon, XIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import "./window-title-bar.scss";

interface WindowTitleBarProps {
  onMinimize: () => void;
  onClose: () => void;
}

export function WindowTitleBar({
  onMinimize,
  onClose,
}: Readonly<WindowTitleBarProps>) {
  const { t } = useTranslation("header");

  return (
    <header className="window-title-bar">
      <h4>Hydra</h4>
      <div className="window-title-bar__controls">
        <button
          type="button"
          className="window-title-bar__control"
          onClick={onMinimize}
          title={t("minimize")}
          aria-label={t("minimize")}
        >
          <DashIcon size={16} />
        </button>
        <button
          type="button"
          className="window-title-bar__control window-title-bar__control--close"
          onClick={onClose}
          title={t("close")}
          aria-label={t("close")}
        >
          <XIcon size={16} />
        </button>
      </div>
    </header>
  );
}
