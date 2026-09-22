import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import EpicLogo from "@renderer/assets/epic-games-logo.svg?react";
import "./store-icons.scss";

interface StoreIconsProps {
  shop: string;
}

export function StoreIcons({ shop }: StoreIconsProps) {
  const platform = [
    { shop: "steam", label: "Steam", Icon: SteamLogo },
    { shop: "epic", label: "Epic Games", Icon: EpicLogo },
  ].find((platform) => platform.shop === shop);
  if (!platform) return null;

  const { label, Icon } = platform;

  return (
    <span className="store-icons">
      <span
        className="store-icons__item"
        role="img"
        aria-label={label}
        title={label}
      >
        <Icon aria-hidden="true" focusable="false" />
      </span>
    </span>
  );
}
