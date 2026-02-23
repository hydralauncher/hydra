import cn from "classnames";
import ProtonDBLogo from "@renderer/assets/protondb-logo.svg?url";

interface ProtonDBBadgeProps {
  badge: string;
}

export function ProtonDBBadge({ badge }: ProtonDBBadgeProps) {
  const label = badge.charAt(0).toUpperCase() + badge.slice(1);

  return (
    <div className="game-item__compatibility-badge-group">
      <span
        className={cn(
          "game-item__compatibility-badge",
          `game-item__compatibility-badge--${badge}`
        )}
        title={`ProtonDB ${label}`}
      >
        <img
          src={ProtonDBLogo}
          alt=""
          aria-hidden="true"
          className="game-item__compatibility-logo"
          width={12}
          height={12}
          loading="lazy"
        />
        <span>{label}</span>
      </span>
    </div>
  );
}
