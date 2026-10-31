import EpicLogo from "@renderer/assets/epic-integration-logo.svg?react";
import { FocusItem } from "../focus-item";
import "./styles.scss";

export function EpicDownloadOption({
  title,
  label,
  onSelect,
  stealFocusOnAppear,
}: Readonly<{
  title: string;
  label: string;
  onSelect: () => void;
  stealFocusOnAppear?: boolean;
}>) {
  return (
    <FocusItem asChild stealFocusOnAppear={stealFocusOnAppear}>
      <button
        type="button"
        className="download-source-option"
        onClick={onSelect}
      >
        <div className="download-source-option__header">
          <div className="download-source-option__header__left">
            <p className="download-source-option__header__left__title download-source-option__steam-title">
              <EpicLogo width={16} height={16} aria-hidden="true" />
              <span>{title}</span>
            </p>
            <p className="download-source-option__header__left__download-source-name">
              {label}
            </p>
          </div>
          <span
            className="download-source-option__availability-dot"
            aria-hidden="true"
          />
        </div>
      </button>
    </FocusItem>
  );
}
