import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { SteamIcon } from "@renderer/components/steam-library-badge/steam-library-badge";
import type { LibrarySource } from "./library-category";
import "./source-icon.scss";

const HYDRA_ICON_VIEW_BOX = "2.5 0 50 47.5";
const HYDRA_ICON_BLEED = 2;

interface SourceIconProps {
  source: LibrarySource;
  size?: number;
}

export function SourceIcon({ source, size = 14 }: Readonly<SourceIconProps>) {
  if (source === "steam") {
    return <SteamIcon size={size} className="library-source-icon" />;
  }

  return (
    <HydraIcon
      viewBox={HYDRA_ICON_VIEW_BOX}
      width={size + HYDRA_ICON_BLEED}
      height={size + HYDRA_ICON_BLEED}
      className="library-source-icon library-source-icon--hydra"
      aria-hidden="true"
    />
  );
}
