import type { LibraryGame } from "@types";
import cn from "classnames";
import { FocusItem, VerticalFocusGroup } from "../../../common";
import { resolveImageSource } from "../../../../helpers";
import type { GameSettingsCategoryId } from "./use-game-settings-controller";
import { categoryLabel, getGameSidebarCoverUrl } from "./helpers";

function SidebarItem({
  categoryId,
  active,
  onClick,
}: Readonly<{
  categoryId: GameSettingsCategoryId;
  active: boolean;
  onClick: () => void;
}>) {
  return (
    <FocusItem asChild>
      <button
        type="button"
        className={cn("game-settings-modal__sidebar-item", {
          "game-settings-modal__sidebar-item--active": active,
        })}
        onClick={onClick}
      >
        <span className="game-settings-modal__sidebar-item-label">
          {categoryLabel(categoryId)}
        </span>
      </button>
    </FocusItem>
  );
}

export function GameSettingsSidebar({
  game,
  categories,
  selectedCategory,
  regionId,
  onCategoryChange,
}: Readonly<{
  game: LibraryGame;
  categories: GameSettingsCategoryId[];
  selectedCategory: GameSettingsCategoryId;
  regionId: string;
  onCategoryChange: (categoryId: GameSettingsCategoryId) => void;
}>) {
  const sidebarCoverUrl = getGameSidebarCoverUrl(game);

  return (
    <aside className="game-settings-modal__sidebar">
      <div className="game-settings-modal__sidebar-cover">
        {sidebarCoverUrl ? (
          <img
            src={resolveImageSource(sidebarCoverUrl)}
            alt=""
            aria-hidden="true"
          />
        ) : null}
        <h2>{game.title}</h2>
      </div>
      <div
        className="game-settings-modal__sidebar-divider"
        aria-hidden="true"
      />

      <VerticalFocusGroup
        regionId={regionId}
        className="game-settings-modal__sidebar-list"
        style={{ gap: 0 }}
      >
        {categories.map((categoryId) => (
          <SidebarItem
            key={categoryId}
            categoryId={categoryId}
            active={selectedCategory === categoryId}
            onClick={() => onCategoryChange(categoryId)}
          />
        ))}
      </VerticalFocusGroup>
    </aside>
  );
}
