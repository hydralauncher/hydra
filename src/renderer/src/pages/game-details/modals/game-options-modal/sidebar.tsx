import type { ReactNode } from "react";
import type { GameSettingsCategoryId } from "./types";

interface CategoryItem {
  id: GameSettingsCategoryId;
  label: string;
  icon: ReactNode;
}

interface GameOptionsSidebarProps {
  categories: CategoryItem[];
  selectedCategory: GameSettingsCategoryId;
  onSelectCategory: (categoryId: GameSettingsCategoryId) => void;
}

export function GameOptionsSidebar({
  categories,
  selectedCategory,
  onSelectCategory,
}: Readonly<GameOptionsSidebarProps>) {
  return (
    <aside className="game-options-modal__sidebar">
      {categories.map((category) => (
        <button
          key={category.id}
          type="button"
          className={`game-options-modal__sidebar-button ${
            selectedCategory === category.id
              ? "game-options-modal__sidebar-button--active"
              : ""
          }`}
          onClick={() => onSelectCategory(category.id)}
        >
          <span className="game-options-modal__sidebar-button-icon">
            {category.icon}
          </span>
          <span>{category.label}</span>
        </button>
      ))}
    </aside>
  );
}
