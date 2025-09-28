import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import { LibraryGame } from "@types";
import cn from "classnames";
import { useLocation } from "react-router-dom";
import { useState } from "react";
import { GameContextMenu } from "./game-context-menu";

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
    isOpen: boolean;
    position: { x: number; y: number };
  }>({ isOpen: false, position: { x: 0, y: 0 } });

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      isOpen: true,
      position: { x: event.clientX, y: event.clientY },
    });
  };

  const closeContextMenu = () => {
    setContextMenu({ isOpen: false, position: { x: 0, y: 0 } });
  };

  const handleDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData(
      "application/json",
      JSON.stringify({
        type: "game",
        gameId: game.id,
        game: game,
      })
    );
    event.dataTransfer.effectAllowed = "copy";
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
        onContextMenu={handleContextMenu}
        draggable
        onDragStart={handleDragStart}
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

      <GameContextMenu
        game={game}
        isOpen={contextMenu.isOpen}
        onClose={closeContextMenu}
        position={contextMenu.position}
      />
    </li>
  );
}
