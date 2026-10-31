import SteamLogo from "@renderer/assets/bi-steam.svg?react";
import type { FocusOverrides } from "../../../services";
import { FocusItem } from "../focus-item";

import "./styles.scss";

interface SteamDownloadOptionProps {
  title: string;
  label: string;
  stealFocusOnAppear?: boolean;
  focusNavigationOverrides?: FocusOverrides;
  onSelect: () => void;
}

export function SteamDownloadOption({
  title,
  label,
  stealFocusOnAppear = false,
  focusNavigationOverrides,
  onSelect,
}: Readonly<SteamDownloadOptionProps>) {
  return (
    <FocusItem
      asChild
      stealFocusOnAppear={stealFocusOnAppear}
      navigationOverrides={focusNavigationOverrides}
    >
      <button className="download-source-option" onClick={onSelect}>
        <div className="download-source-option__header">
          <div className="download-source-option__header__left">
            <p className="download-source-option__header__left__title download-source-option__steam-title">
              <SteamLogo width={16} height={16} aria-hidden="true" />
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
