import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import EpicLogo from "@renderer/assets/epic-games-logo.svg?react";
import "./store-icons.scss";

interface StoreIconsProps {
  shops: readonly string[];
}

const platforms = [
  { shop: "steam", label: "Steam", Icon: SteamLogo },
  { shop: "epic", label: "Epic Games", Icon: EpicLogo },
];

export function StoreIcons({ shops }: StoreIconsProps) {
  const visiblePlatforms = [...new Set(shops)]
    .map((shop) => platforms.find((platform) => platform.shop === shop))
    .filter((platform) => platform !== undefined);

  if (visiblePlatforms.length === 0) return null;

  return (
    <span className="store-icons">
      {visiblePlatforms.map(({ shop, label, Icon }) => (
        <span
          key={shop}
          className="store-icons__item"
          role="img"
          aria-label={label}
          title={label}
        >
          <Icon aria-hidden="true" focusable="false" />
        </span>
      ))}
    </span>
  );
}
