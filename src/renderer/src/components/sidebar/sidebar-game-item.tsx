import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import { LibraryGame } from "@types";
import cn from "classnames";
import { useLocation } from "react-router-dom";

export function SidebarGameItem({
  game,
  handleSidebarGameClick,
  getGameTitle,
}: {
  game: LibraryGame;
  handleSidebarGameClick: (event: React.MouseEvent, game: LibraryGame) => void;
  getGameTitle: (game: LibraryGame) => string;
}) {
  const location = useLocation();

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
        {game.iconUrl ? (
          <img
            className="sidebar__game-icon"
            src={game.iconUrl}
            alt={game.title}
            loading="lazy"
          />
        ) : (
          <SteamLogo className="sidebar__game-icon" />
        )}

        <span className="sidebar__menu-item-button-label">
          {getGameTitle(game)}
        </span>
      </button>
    </li>
  );
}
