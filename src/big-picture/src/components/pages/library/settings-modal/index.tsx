import "./styles.scss";

import type { GameArtifact, LibraryGame } from "@types";
import cn from "classnames";
import { useMemo, useState } from "react";
import {
  HorizontalFocusGroup,
  Modal,
  NavigationLayer,
  VerticalFocusGroup,
} from "../../../common";
import { GameSettingsSidebar } from "./sidebar";
import { GameSettingsPanelContent } from "./sections";
import {
  ChangePlaytimeModal,
  ConfirmationModal,
  CreateSteamShortcutModal,
  ManageFilesModal,
  RenameArtifactModal,
} from "./submodals";
import type { GameSettingsConfirmation } from "./types";
import { useGameSettingsCloudSync } from "./use-game-settings-cloud-sync";
import {
  type GameSettingsCategoryId,
  useGameSettingsController,
} from "./use-game-settings-controller";

export interface GameSettingsModalProps {
  visible: boolean;
  game: LibraryGame | null;
  onClose: () => void;
  onGameUpdated?: (game: LibraryGame | null) => void;
}

const ROOT_REGION_ID = "library-game-settings-modal-root";
const CATEGORIES_REGION_ID = "library-game-settings-modal-categories";
const PANEL_REGION_ID = "library-game-settings-modal-panel";

function getSettingsCategories() {
  const categories: GameSettingsCategoryId[] = [
    "general",
    "assets",
    "hydra_cloud",
    "downloads",
    "danger_zone",
  ];

  if (globalThis.window.electron?.platform === "linux") {
    categories.splice(3, 0, "compatibility");
  }

  return categories;
}

export function GameSettingsModal({
  visible,
  game: initialGame,
  onClose,
  onGameUpdated,
}: Readonly<GameSettingsModalProps>) {
  const controller = useGameSettingsController({
    visible,
    initialGame,
    onClose,
    onGameUpdated,
  });
  const cloudSync = useGameSettingsCloudSync({
    visible,
    game: controller.game,
    hasActiveSubscription: controller.hasActiveSubscription,
    onFeedback: controller.notify,
  });
  const [showSteamShortcutModal, setShowSteamShortcutModal] = useState(false);
  const [confirmation, setConfirmation] =
    useState<GameSettingsConfirmation | null>(null);
  const [showChangePlaytimeModal, setShowChangePlaytimeModal] = useState(false);
  const [artifactToRename, setArtifactToRename] = useState<GameArtifact | null>(
    null
  );
  const [artifactToDelete, setArtifactToDelete] = useState<GameArtifact | null>(
    null
  );
  const [showManageFilesModal, setShowManageFilesModal] = useState(false);
  const categories = useMemo(getSettingsCategories, []);
  const game = controller.game;

  if (!game) return null;

  return (
    <>
      <Modal
        visible={visible}
        onClose={onClose}
        className="game-settings-modal"
      >
        <NavigationLayer
          rootRegionId={ROOT_REGION_ID}
          initialFocusRegionId={CATEGORIES_REGION_ID}
        >
          <HorizontalFocusGroup
            regionId={ROOT_REGION_ID}
            className="game-settings-modal__shell"
            style={{ gap: 0, alignItems: "stretch" }}
          >
            <GameSettingsSidebar
              game={game}
              categories={categories}
              selectedCategory={controller.selectedCategory}
              regionId={CATEGORIES_REGION_ID}
              onCategoryChange={controller.setSelectedCategory}
            />

            <main className="game-settings-modal__panel">
              {controller.feedback && (
                <div
                  className={cn(
                    "game-settings-modal__feedback",
                    `game-settings-modal__feedback--${controller.feedback.type}`
                  )}
                >
                  {controller.feedback.message}
                </div>
              )}

              <VerticalFocusGroup
                regionId={PANEL_REGION_ID}
                autoScrollMode="region"
              >
                <GameSettingsPanelContent
                  controller={controller}
                  cloudSync={cloudSync}
                  onOpenSteamShortcutModal={() =>
                    setShowSteamShortcutModal(true)
                  }
                  onOpenChangePlaytimeModal={() =>
                    setShowChangePlaytimeModal(true)
                  }
                  onOpenManageFilesModal={() => setShowManageFilesModal(true)}
                  onRenameArtifact={setArtifactToRename}
                  onDeleteArtifact={(artifact) => {
                    setArtifactToDelete(artifact);
                    setConfirmation("delete-artifact");
                  }}
                  onRequestConfirmation={setConfirmation}
                />
              </VerticalFocusGroup>
            </main>
          </HorizontalFocusGroup>
        </NavigationLayer>
      </Modal>

      <CreateSteamShortcutModal
        visible={showSteamShortcutModal}
        creating={controller.busyAction === "create-steam-shortcut"}
        onClose={() => setShowSteamShortcutModal(false)}
        onConfirm={controller.handleCreateSteamShortcut}
      />

      <ChangePlaytimeModal
        visible={showChangePlaytimeModal}
        game={game}
        onClose={() => setShowChangePlaytimeModal(false)}
        onConfirm={controller.handleChangePlaytime}
      />

      <RenameArtifactModal
        visible={Boolean(artifactToRename)}
        artifact={artifactToRename}
        onClose={() => setArtifactToRename(null)}
        onConfirm={cloudSync.renameGameArtifact}
      />

      <ManageFilesModal
        visible={showManageFilesModal}
        backupPreview={cloudSync.backupPreview}
        onClose={() => setShowManageFilesModal(false)}
        onSetBackupPath={cloudSync.setBackupPath}
      />

      <ConfirmationModal
        visible={confirmation === "remove-library"}
        title="Remove from library?"
        description={`Remove ${game.title} from your library. Downloaded files will not be deleted.`}
        confirmLabel="Remove"
        danger
        onClose={() => setConfirmation(null)}
        onConfirm={controller.handleRemoveFromLibrary}
      />

      <ConfirmationModal
        visible={confirmation === "reset-achievements"}
        title="Reset achievements?"
        description="This removes local achievement progress for this game."
        confirmLabel="Reset"
        danger
        onClose={() => setConfirmation(null)}
        onConfirm={controller.handleResetAchievements}
      />

      <ConfirmationModal
        visible={confirmation === "remove-files"}
        title="Remove downloaded files?"
        description="This deletes the downloaded game files from disk."
        confirmLabel="Remove files"
        danger
        onClose={() => setConfirmation(null)}
        onConfirm={controller.handleRemoveGameFiles}
      />

      <ConfirmationModal
        visible={confirmation === "delete-artifact"}
        title="Delete backup?"
        description={`Delete ${
          artifactToDelete?.label ?? "this backup"
        }. Frozen backups cannot be deleted.`}
        confirmLabel="Delete"
        danger
        onClose={() => {
          setConfirmation(null);
          setArtifactToDelete(null);
        }}
        onConfirm={async () => {
          if (artifactToDelete) {
            await cloudSync.deleteGameArtifact(artifactToDelete.id);
          }
        }}
      />
    </>
  );
}
