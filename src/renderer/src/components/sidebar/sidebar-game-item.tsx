import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import PlayLogo from "@renderer/assets/play-logo.svg?react";
import { LibraryGame } from "@types";
import cn from "classnames";
import { useLocation } from "react-router-dom";
import { useState } from "react";
import { GameContextMenu } from "..";

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
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    position: { x: number; y: number };
  }>({ visible: false, position: { x: 0, y: 0 } });

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    setContextMenu({
      visible: true,
      position: { x: event.clientX, y: event.clientY },
    });
  };

  const handleCloseContextMenu = () => {
    setContextMenu({ visible: false, position: { x: 0, y: 0 } });
  };

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
    <>
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
          onContextMenu={handleContextMenu}
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

      <GameContextMenu
        game={game}
        visible={contextMenu.visible}
        position={contextMenu.position}
        onClose={handleCloseContextMenu}
      />
    </>
  );
}
