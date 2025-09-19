import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import PlayLogo from "@renderer/assets/play-logo.svg?react";
import { LibraryGame } from "@types";
import cn from "classnames";
import { useLocation } from "react-router-dom";

interface SidebarGameItemProps {
  game: LibraryGame;
  handleSidebarGameClick: (event: React.MouseEvent, game: LibraryGame) => void;
  getGameTitle: (game: LibraryGame) => string;
}

export function SidebarGameItem({
  game,
  handleSidebarGameClick,
  getGameTitle,
}: Readonly<SidebarGameItemProps>) {
  const location = useLocation();

  const isCustomGame = game.shop === "custom";
  const sidebarIcon = isCustomGame
    ? game.libraryImageUrl || game.iconUrl
    : game.customIconUrl || game.iconUrl;

  // Determine fallback icon based on game type
  const getFallbackIcon = () => {
    if (isCustomGame) {
      return <PlayLogo className="sidebar__game-icon" />;
    }
    return <SteamLogo className="sidebar__game-icon" />;
  };

  return (
    <li
      key={game.id}
      className={cn("sidebar__menu-item", {
        "sidebar__menu-item--active":
          location.pathname === `/game/${game.shop}/${game.objectId}`,
        "sidebar__menu-item--muted": game.download?.status === "removed",
      })}
    >
      <button
        type="button"
        className="sidebar__menu-item-button"
        onClick={(event) => handleSidebarGameClick(event, game)}
      >
        {sidebarIcon ? (
          <img
            className="sidebar__game-icon"
            src={sidebarIcon}
            alt={game.title}
            loading="lazy"
          />
        ) : (
          getFallbackIcon()
        )}

        <span className="sidebar__menu-item-button-label">
          {getGameTitle(game)}
        </span>
      </button>
    </li>
  );
}
