import {
  ArrowsClockwiseIcon,
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  CloudIcon,
  FileIcon,
  FloppyDiskIcon,
  FolderOpenIcon,
  HardDriveIcon,
  ImageIcon,
  PencilSimpleIcon,
  PushPinIcon,
  PushPinSlashIcon,
  SparkleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { GameArtifact, LibraryGame } from "@types";
import { formatBytes } from "@shared";
import { Button, HorizontalFocusGroup } from "../../../common";
import { resolveImageSource } from "../../../../helpers";
import type { GameSettingsCloudSync } from "./use-game-settings-cloud-sync";
import type { GameSettingsController } from "./use-game-settings-controller";
import type { GameSettingsConfirmation } from "./types";
import { FocusableInput, SettingsSection, ToggleAction } from "./shared";
import {
  assetLabel,
  formatBackupStateLabel,
  formatDateTime,
  GAME_SETTINGS_ASSET_TYPES,
  getGameAssetUrl,
  getGameOriginalAssetPath,
} from "./helpers";

type GameSettingsPanelContentProps = Readonly<{
  controller: GameSettingsController;
  cloudSync: GameSettingsCloudSync;
  onOpenSteamShortcutModal: () => void;
  onOpenChangePlaytimeModal: () => void;
  onOpenManageFilesModal: () => void;
  onRenameArtifact: (artifact: GameArtifact) => void;
  onDeleteArtifact: (artifact: GameArtifact) => void;
  onRequestConfirmation: (confirmation: GameSettingsConfirmation) => void;
}>;

function GeneralSection({
  game,
  controller,
  onOpenSteamShortcutModal,
}: Readonly<{
  game: LibraryGame;
  controller: GameSettingsController;
  onOpenSteamShortcutModal: () => void;
}>) {
  const canOpenSaveFolder =
    game.shop !== "custom" && globalThis.window.electron.platform === "win32";

  let saveFolderButtonLabel = "No save folder found";
  if (controller.loadingSaveFolder) {
    saveFolderButtonLabel = "Searching save folder";
  } else if (controller.saveFolderPath) {
    saveFolderButtonLabel = "Open save folder";
  }

  return (
    <>
      <SettingsSection title="Title">
        <div className="game-settings-modal__field-row">
          <FocusableInput
            label="Game title"
            value={controller.gameTitle}
            disabled={controller.updatingTitle}
            onChange={controller.setGameTitle}
          />
          <Button
            icon={<FloppyDiskIcon size={18} />}
            disabled={controller.updatingTitle}
            onClick={controller.handleSaveTitle}
          >
            Save
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Executable"
        description="Choose the executable used to launch this game."
      >
        <div className="game-settings-modal__path-card">
          <span>{game.executablePath || "No executable selected"}</span>
        </div>
        <HorizontalFocusGroup className="game-settings-modal__actions">
          <Button
            variant="secondary"
            icon={<FileIcon size={18} />}
            onClick={controller.handleSelectExecutable}
          >
            Select executable
          </Button>
          <Button
            variant="secondary"
            disabled={!game.executablePath}
            onClick={controller.handleOpenExecutableFolder}
          >
            Open folder
          </Button>
          <Button
            variant="secondary"
            disabled={!game.executablePath}
            onClick={controller.handleClearExecutable}
          >
            Clear
          </Button>
          {canOpenSaveFolder && (
            <Button
              variant="secondary"
              disabled={
                controller.loadingSaveFolder || !controller.saveFolderPath
              }
              onClick={controller.handleOpenSaveFolder}
            >
              {saveFolderButtonLabel}
            </Button>
          )}
        </HorizontalFocusGroup>
      </SettingsSection>

      {game.executablePath && (
        <SettingsSection
          title="Shortcuts"
          description="Create shortcuts for faster access."
        >
          <HorizontalFocusGroup className="game-settings-modal__actions">
            <Button
              variant="secondary"
              onClick={() => controller.handleCreateShortcut("desktop")}
            >
              Desktop shortcut
            </Button>
            {globalThis.window.electron.platform === "win32" && (
              <Button
                variant="secondary"
                onClick={() => controller.handleCreateShortcut("start_menu")}
              >
                Start menu shortcut
              </Button>
            )}
            {game.shop !== "custom" &&
              (controller.steamShortcutExists ? (
                <Button
                  variant="danger"
                  onClick={controller.handleDeleteSteamShortcut}
                >
                  Delete Steam shortcut
                </Button>
              ) : (
                <Button variant="secondary" onClick={onOpenSteamShortcutModal}>
                  Create Steam shortcut
                </Button>
              ))}
          </HorizontalFocusGroup>
        </SettingsSection>
      )}

      <SettingsSection
        title="Launch options"
        description="Add arguments to the game launch command."
      >
        <FocusableInput
          label="Arguments"
          value={controller.launchOptions}
          placeholder="%command% --fullscreen"
          onChange={controller.setLaunchOptions}
        />
        <HorizontalFocusGroup className="game-settings-modal__actions">
          <Button onClick={controller.handleSaveLaunchOptions}>
            Save launch options
          </Button>
          <Button
            variant="secondary"
            disabled={!game.launchOptions}
            onClick={controller.handleClearLaunchOptions}
          >
            Clear
          </Button>
        </HorizontalFocusGroup>
      </SettingsSection>
    </>
  );
}

function AssetsSection({
  game,
  controller,
}: Readonly<{
  game: LibraryGame;
  controller: GameSettingsController;
}>) {
  return (
    <SettingsSection
      title="Assets"
      description="Customize the library art used by Hydra."
    >
      <div className="game-settings-modal__assets">
        {GAME_SETTINGS_ASSET_TYPES.map((assetType) => {
          const assetUrl = getGameAssetUrl(game, assetType);
          const originalPath = getGameOriginalAssetPath(game, assetType);

          return (
            <div key={assetType} className="game-settings-modal__asset-card">
              <div className="game-settings-modal__asset-preview">
                {assetUrl ? (
                  <img
                    src={resolveImageSource(assetUrl)}
                    alt={assetLabel(assetType)}
                  />
                ) : (
                  <ImageIcon size={42} />
                )}
              </div>
              <div className="game-settings-modal__asset-info">
                <h4>{assetLabel(assetType)}</h4>
                <p>{originalPath || "No custom asset selected"}</p>
                <HorizontalFocusGroup className="game-settings-modal__actions">
                  <Button
                    variant="secondary"
                    onClick={() => controller.handleChooseAsset(assetType)}
                  >
                    Select image
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!originalPath}
                    onClick={() => controller.handleResetAsset(assetType)}
                  >
                    Reset
                  </Button>
                  <Button
                    variant="danger"
                    disabled={!assetUrl}
                    onClick={() =>
                      controller.handleUpdateAsset(assetType, null)
                    }
                  >
                    Remove
                  </Button>
                </HorizontalFocusGroup>
              </div>
            </div>
          );
        })}
      </div>
    </SettingsSection>
  );
}

function HydraCloudSection({
  game,
  controller,
  cloudSync,
  onOpenManageFilesModal,
  onRenameArtifact,
  onDeleteArtifact,
}: Readonly<{
  game: LibraryGame;
  controller: GameSettingsController;
  cloudSync: GameSettingsCloudSync;
  onOpenManageFilesModal: () => void;
  onRenameArtifact: (artifact: GameArtifact) => void;
  onDeleteArtifact: (artifact: GameArtifact) => void;
}>) {
  const cloudActionsDisabled =
    cloudSync.uploadingBackup ||
    cloudSync.restoringBackup ||
    cloudSync.freezingArtifact ||
    cloudSync.deletingArtifact;
  const backupsLimit = controller.userDetails?.quirks?.backupsPerGameLimit ?? 0;
  const hasReachedBackupsLimit =
    backupsLimit > 0 && cloudSync.artifacts.length >= backupsLimit;

  let hydraCloudBody: ReactNode;
  if (game.shop === "custom") {
    hydraCloudBody = (
      <p className="game-settings-modal__empty-note">
        Settings are not available for custom games.
      </p>
    );
  } else if (controller.hasActiveSubscription) {
    hydraCloudBody = (
      <>
        <ToggleAction
          label="Automatic cloud sync"
          checked={game.automaticCloudSync === true}
          disabled={!game.executablePath}
          onToggle={controller.handleToggleAutomaticCloudSync}
        />
        <div className="game-settings-modal__cloud-header">
          <div>
            <p>
              {formatBackupStateLabel(
                cloudSync.backupState,
                cloudSync.loadingPreview,
                cloudSync.uploadingBackup,
                cloudSync.restoringBackup,
                cloudSync.backupDownloadProgress?.progress ?? 0
              )}
            </p>
            <Button
              variant="link"
              disabled={cloudActionsDisabled}
              onClick={onOpenManageFilesModal}
            >
              Manage files
            </Button>
          </div>
          <Button
            icon={
              cloudSync.uploadingBackup ? (
                <ArrowsClockwiseIcon size={18} />
              ) : (
                <CloudArrowUpIcon size={18} />
              )
            }
            disabled={
              cloudActionsDisabled ||
              !cloudSync.backupPreview?.overall.totalGames ||
              hasReachedBackupsLimit
            }
            onClick={cloudSync.uploadSaveGame}
          >
            Create backup
          </Button>
        </div>
        <div className="game-settings-modal__backups-title">
          <h4>Backups</h4>
          <span>{cloudSync.artifacts.length}</span>
        </div>
        <div className="game-settings-modal__backups">
          {cloudSync.artifacts.length === 0 ? (
            <p className="game-settings-modal__empty-note">
              No backups created.
            </p>
          ) : (
            cloudSync.artifacts
              .toSorted((a, b) => Number(b.isFrozen) - Number(a.isFrozen))
              .map((artifact) => (
                <BackupCard
                  key={artifact.id}
                  artifact={artifact}
                  cloudActionsDisabled={cloudActionsDisabled}
                  cloudSync={cloudSync}
                  onRenameArtifact={onRenameArtifact}
                  onDeleteArtifact={onDeleteArtifact}
                />
              ))
          )}
        </div>
      </>
    );
  } else {
    hydraCloudBody = (
      <div className="game-settings-modal__upgrade-card">
        <CloudIcon size={28} />
        <p>Hydra Cloud is available with an active subscription.</p>
        <Button onClick={() => globalThis.electron.openCheckout()}>
          Learn more
        </Button>
      </div>
    );
  }

  return (
    <SettingsSection
      title="Hydra Cloud"
      description="Manage cloud saves and backups for this game."
    >
      {hydraCloudBody}
    </SettingsSection>
  );
}

function BackupCard({
  artifact,
  cloudActionsDisabled,
  cloudSync,
  onRenameArtifact,
  onDeleteArtifact,
}: Readonly<{
  artifact: GameArtifact;
  cloudActionsDisabled: boolean;
  cloudSync: GameSettingsCloudSync;
  onRenameArtifact: (artifact: GameArtifact) => void;
  onDeleteArtifact: (artifact: GameArtifact) => void;
}>) {
  const artifactName =
    artifact.label ?? `Backup from ${formatDateTime(artifact.createdAt)}`;

  return (
    <div className="game-settings-modal__backup-card">
      <div>
        <Button
          variant="link"
          icon={<PencilSimpleIcon size={16} />}
          onClick={() => onRenameArtifact(artifact)}
        >
          {artifactName}
        </Button>
        <p>
          {formatBytes(artifact.artifactLengthInBytes)} - {artifact.hostname} -{" "}
          {formatDateTime(artifact.createdAt)}
        </p>
        <p>{artifact.downloadOptionTitle ?? "No download option info"}</p>
      </div>
      <HorizontalFocusGroup className="game-settings-modal__actions">
        <Button
          variant="secondary"
          icon={<CloudArrowDownIcon size={18} />}
          disabled={cloudActionsDisabled}
          onClick={() => cloudSync.downloadGameArtifact(artifact.id)}
        >
          Install
        </Button>
        <Button
          variant="secondary"
          icon={
            artifact.isFrozen ? (
              <PushPinSlashIcon size={18} />
            ) : (
              <PushPinIcon size={18} />
            )
          }
          disabled={cloudActionsDisabled}
          onClick={() =>
            cloudSync.toggleArtifactFreeze(artifact.id, !artifact.isFrozen)
          }
        >
          {artifact.isFrozen ? "Unfreeze" : "Freeze"}
        </Button>
        <Button
          variant="danger"
          icon={<TrashIcon size={18} />}
          disabled={cloudActionsDisabled || artifact.isFrozen}
          onClick={() => onDeleteArtifact(artifact)}
        >
          Delete
        </Button>
      </HorizontalFocusGroup>
    </div>
  );
}

function CompatibilitySection({
  game,
  controller,
}: Readonly<{
  game: LibraryGame;
  controller: GameSettingsController;
}>) {
  return (
    <>
      <SettingsSection
        title="Wine prefix"
        description="Select the Wine prefix used by this game."
      >
        <div className="game-settings-modal__path-card">
          <span>
            {controller.displayedWinePrefixPath || "No directory selected"}
          </span>
        </div>
        <HorizontalFocusGroup className="game-settings-modal__actions">
          <Button
            variant="secondary"
            onClick={controller.handleChangeWinePrefixPath}
          >
            Select directory
          </Button>
          <Button
            variant="secondary"
            disabled={!game.winePrefixPath}
            onClick={controller.handleClearWinePrefixPath}
          >
            Clear
          </Button>
          <Button
            variant="secondary"
            disabled={!controller.winetricksAvailable}
            onClick={controller.handleOpenWinetricks}
          >
            Open Winetricks
          </Button>
        </HorizontalFocusGroup>
      </SettingsSection>

      <SettingsSection title="Additional options">
        <HorizontalFocusGroup className="game-settings-modal__actions">
          <ToggleAction
            label="Run with GameMode"
            checked={
              controller.autoRunGamemode || controller.globalAutoRunGamemode
            }
            disabled={
              !controller.gamemodeAvailable || controller.globalAutoRunGamemode
            }
            onToggle={controller.handleToggleGamemode}
          />
          <ToggleAction
            label="Run with MangoHud"
            checked={
              controller.autoRunMangohud || controller.globalAutoRunMangohud
            }
            disabled={
              !controller.mangohudAvailable || controller.globalAutoRunMangohud
            }
            onToggle={controller.handleToggleMangohud}
          />
        </HorizontalFocusGroup>
      </SettingsSection>

      <SettingsSection
        title="Proton version"
        description="Choose a Proton version for this game."
      >
        <div className="game-settings-modal__proton-list">
          <Button
            variant={
              controller.selectedProtonPath === "" ? "primary" : "secondary"
            }
            onClick={() => controller.handleChangeProtonVersion("")}
          >
            Auto
          </Button>
          {controller.protonVersions.map((version) => (
            <Button
              key={version.path}
              variant={
                controller.selectedProtonPath === version.path
                  ? "primary"
                  : "secondary"
              }
              onClick={() => controller.handleChangeProtonVersion(version.path)}
            >
              {version.name}
            </Button>
          ))}
        </div>
      </SettingsSection>
    </>
  );
}

function DownloadsSection({
  game,
  controller,
}: Readonly<{
  game: LibraryGame;
  controller: GameSettingsController;
}>) {
  return (
    <SettingsSection
      title="Downloads"
      description="Manage download options and local download files."
    >
      {game.shop === "custom" ? (
        <p className="game-settings-modal__empty-note">
          Settings are not available for custom games.
        </p>
      ) : (
        <HorizontalFocusGroup className="game-settings-modal__actions">
          <Button variant="secondary" disabled>
            Open download options
          </Button>
          <Button
            variant="secondary"
            icon={<FolderOpenIcon size={18} />}
            disabled={!game.download?.downloadPath}
            onClick={controller.handleOpenDownloadFolder}
          >
            Open download location
          </Button>
        </HorizontalFocusGroup>
      )}
    </SettingsSection>
  );
}

function DangerZoneSection({
  game,
  controller,
  onOpenChangePlaytimeModal,
  onRequestConfirmation,
}: Readonly<{
  game: LibraryGame;
  controller: GameSettingsController;
  onOpenChangePlaytimeModal: () => void;
  onRequestConfirmation: (confirmation: GameSettingsConfirmation) => void;
}>) {
  return (
    <SettingsSection
      title="Danger Zone"
      description="These actions can permanently change this game."
      danger
    >
      <div className="game-settings-modal__danger-actions">
        <Button
          variant="danger"
          icon={<TrashIcon size={18} />}
          onClick={() => onRequestConfirmation("remove-library")}
        >
          Remove from library
        </Button>
        {game.shop !== "custom" && (
          <Button
            variant="danger"
            icon={<SparkleIcon size={18} />}
            disabled={
              controller.isDeletingAchievements ||
              !controller.hasAchievements ||
              !controller.userDetails
            }
            onClick={() => onRequestConfirmation("reset-achievements")}
          >
            Reset achievements
          </Button>
        )}
        <Button
          variant="danger"
          icon={<HardDriveIcon size={18} />}
          onClick={onOpenChangePlaytimeModal}
        >
          Update playtime
        </Button>
        {game.shop !== "custom" && (
          <Button
            variant="danger"
            icon={<TrashIcon size={18} />}
            disabled={
              controller.isGameDownloading ||
              controller.isDeletingGameFiles ||
              !game.download?.downloadPath
            }
            onClick={() => onRequestConfirmation("remove-files")}
          >
            Remove files
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}

export function GameSettingsPanelContent({
  controller,
  cloudSync,
  onOpenSteamShortcutModal,
  onOpenChangePlaytimeModal,
  onOpenManageFilesModal,
  onRenameArtifact,
  onDeleteArtifact,
  onRequestConfirmation,
}: GameSettingsPanelContentProps) {
  const game = controller.game;
  if (!game) return null;

  if (controller.selectedCategory === "general") {
    return (
      <GeneralSection
        game={game}
        controller={controller}
        onOpenSteamShortcutModal={onOpenSteamShortcutModal}
      />
    );
  }

  if (controller.selectedCategory === "assets") {
    return <AssetsSection game={game} controller={controller} />;
  }

  if (controller.selectedCategory === "hydra_cloud") {
    return (
      <HydraCloudSection
        game={game}
        controller={controller}
        cloudSync={cloudSync}
        onOpenManageFilesModal={onOpenManageFilesModal}
        onRenameArtifact={onRenameArtifact}
        onDeleteArtifact={onDeleteArtifact}
      />
    );
  }

  if (controller.selectedCategory === "compatibility") {
    return <CompatibilitySection game={game} controller={controller} />;
  }

  if (controller.selectedCategory === "downloads") {
    return <DownloadsSection game={game} controller={controller} />;
  }

  return (
    <DangerZoneSection
      game={game}
      controller={controller}
      onOpenChangePlaytimeModal={onOpenChangePlaytimeModal}
      onRequestConfirmation={onRequestConfirmation}
    />
  );
}
