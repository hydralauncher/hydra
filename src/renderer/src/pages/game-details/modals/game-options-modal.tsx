import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@renderer/components";

import type {
  CreateSteamShortcutOptions,
  Game,
  LibraryGame,
  ProtonVersion,
  ShortcutLocation,
} from "@types";
import { gameDetailsContext } from "@renderer/context";
import { DeleteGameModal } from "@renderer/pages/downloads/delete-game-modal";
import {
  useAppSelector,
  useDownload,
  useGameCollections,
  useLibrary,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { RemoveGameFromLibraryModal } from "./remove-from-library-modal";
import { ResetAchievementsModal } from "./reset-achievements-modal";
import { ChangeGamePlaytimeModal } from "./change-game-playtime-modal";
import {
  AlertIcon,
  CloudIcon,
  DownloadIcon,
  GearIcon,
  ImageIcon,
} from "@primer/octicons-react";
import { Wrench } from "lucide-react";
import { GameAssetsSettings } from "./game-assets-settings";
import { debounce } from "lodash-es";
import { levelDBService } from "@renderer/services/leveldb.service";
import { getGameKey } from "@renderer/helpers";
import "./game-options-modal.scss";
import { logger } from "@renderer/logger";
import { GameOptionsSidebar } from "./game-options-modal/sidebar";
import { GeneralSettingsSection } from "./game-options-modal/general-section";
import { CompatibilitySettingsSection } from "./game-options-modal/compatibility-section";
import { DownloadsSettingsSection } from "./game-options-modal/downloads-section";
import { DangerZoneSection } from "./game-options-modal/danger-zone-section";
import { HydraCloudSettingsSection } from "./game-options-modal/hydra-cloud-section";
import type { GameSettingsCategoryId } from "./game-options-modal/types";
import { CreateSteamShortcutModal } from "./create-steam-shortcut-modal";

export interface GameOptionsModalProps {
  visible: boolean;
  game: LibraryGame;
  onClose: () => void;
  onNavigateHome?: () => void;
  initialCategory?: GameSettingsCategoryId;
}

export function GameOptionsModal({
  visible,
  game,
  onClose,
  onNavigateHome,
  initialCategory,
}: Readonly<GameOptionsModalProps>) {
  const MANGOHUD_SITE_URL = "https://mangohud.com";
  const GAMEMODE_SITE_URL = "https://github.com/FeralInteractive/gamemode";
  const { t } = useTranslation("game_details");

  const { showSuccessToast, showErrorToast } = useToast();
  const { updateLibrary } = useLibrary();
  const { loadCollections } = useGameCollections();

  const {
    updateGame,
    setShowRepacksModal,
    repacks,
    selectGameExecutable,
    achievements,
    shopDetails,
    isTransferring,
  } = useContext(gameDetailsContext);

  const [transferProgress, setTransferProgress] = useState(0);
  const [drives, setDrives] = useState<any[]>([]);
  const [transferSpeed, setTransferSpeed] = useState(0);
  const [transferETA, setTransferETA] = useState(0);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRemoveGameModal, setShowRemoveGameModal] = useState(false);
  const [gameTitle, setGameTitle] = useState(game.title ?? "");
  const [updatingGameTitle, setUpdatingGameTitle] = useState(false);
  const [launchOptions, setLaunchOptions] = useState(game.launchOptions ?? "");
  const [showResetAchievementsModal, setShowResetAchievementsModal] = useState(false);
  const [showChangePlaytimeModal, setShowChangePlaytimeModal] = useState(false);
  const [isDeletingAchievements, setIsDeletingAchievements] = useState(false);
  const [automaticCloudSync, setAutomaticCloudSync] = useState(game.automaticCloudSync ?? false);
  const [creatingSteamShortcut, setCreatingSteamShortcut] = useState(false);
  const [saveFolderPath, setSaveFolderPath] = useState<string | null>(null);
  const [loadingSaveFolder, setLoadingSaveFolder] = useState(false);
  const [protonVersions, setProtonVersions] = useState<ProtonVersion[]>([]);
  const [selectedProtonPath, setSelectedProtonPath] = useState(game.protonPath ?? "");
  const [autoRunMangohud, setAutoRunMangohud] = useState<boolean>(game.autoRunMangohud === true);
  const [autoRunGamemode, setAutoRunGamemode] = useState<boolean>(game.autoRunGamemode === true);
  const [gamemodeAvailable, setGamemodeAvailable] = useState(false);
  const [mangohudAvailable, setMangohudAvailable] = useState(false);
  const [winetricksAvailable, setWinetricksAvailable] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<GameSettingsCategoryId>("general");
  const [defaultWinePrefixPath, setDefaultWinePrefixPath] = useState<string | null>(null);
  const [showSteamShortcutModal, setShowSteamShortcutModal] = useState(false);
  const [steamShortcutExists, setSteamShortcutExists] = useState(false);

  const { removeGameInstaller, removeGameFromLibrary, isGameDeleting, cancelDownload } = useDownload();
  const { userDetails } = useUserDetails();
  const userPreferences = useAppSelector((state) => state.userPreferences.value);

  const globalAutoRunGamemode = userPreferences?.autoRunGamemode === true;
  const globalAutoRunMangohud = userPreferences?.autoRunMangohud === true;
  const hasAchievements = (achievements?.filter((a) => a.unlocked).length ?? 0) > 0;
  const deleting = isGameDeleting(game.id);
  const { lastPacket } = useDownload();
  const isGameDownloading = game.download?.status === "active" && lastPacket?.gameId === game.id;

  useEffect(() => {
    if (visible) {
      window.electron.getAvailableDrives?.()
        .then(setDrives)
        .catch((err) => console.error("Failed to fetch drives:", err));
    }
  }, [visible]);

  useEffect(() => {
    if (visible && game.shop !== "custom" && window.electron.platform === "win32") {
      setLoadingSaveFolder(true);
      setSaveFolderPath(null);
      window.electron.getGameSaveFolder(game.shop, game.objectId)
        .then(setSaveFolderPath)
        .catch(() => setSaveFolderPath(null))
        .finally(() => setLoadingSaveFolder(false));
    }
  }, [visible, game.shop, game.objectId]);

  useEffect(() => { setGameTitle(game.title ?? ""); }, [game.title]);
  useEffect(() => { setSelectedProtonPath(game.protonPath ?? ""); }, [game.protonPath]);
  useEffect(() => { setAutoRunMangohud(game.autoRunMangohud === true); }, [game.autoRunMangohud]);
  useEffect(() => { setAutoRunGamemode(game.autoRunGamemode === true); }, [game.autoRunGamemode]);

  useEffect(() => {
    if (!visible || window.electron.platform !== "linux") return;
    window.electron.getInstalledProtonVersions().then(setProtonVersions).catch(() => setProtonVersions([]));
  }, [visible]);

  useEffect(() => {
    if (!visible || window.electron.platform !== "linux") { setDefaultWinePrefixPath(null); return; }
    window.electron.getDefaultWinePrefixSelectionPath().then(setDefaultWinePrefixPath).catch(() => setDefaultWinePrefixPath(null));
  }, [visible]);

  useEffect(() => {
    if (!visible || window.electron.platform !== "linux") { setGamemodeAvailable(false); return; }
    window.electron.isGamemodeAvailable().then(setGamemodeAvailable).catch(() => setGamemodeAvailable(false));
  }, [visible]);

  useEffect(() => {
    if (!visible || window.electron.platform !== "linux") { setMangohudAvailable(false); return; }
    window.electron.isMangohudAvailable().then(setMangohudAvailable).catch(() => setMangohudAvailable(false));
  }, [visible]);

  useEffect(() => {
    if (!visible || window.electron.platform !== "linux") { setWinetricksAvailable(false); return; }
    window.electron.isWinetricksAvailable().then(setWinetricksAvailable).catch(() => setWinetricksAvailable(false));
  }, [visible]);

  useEffect(() => {
    if (game.shop !== "custom") {
      window.electron.checkSteamShortcut(game.shop, game.objectId)
        .then(setSteamShortcutExists)
        .catch(() => setSteamShortcutExists(false));
    }
  }, [game.shop, game.objectId]);

  useEffect(() => {
    const onProgress = (_: unknown, shop: string, oid: string, progress: number, details?: any) => {
      if (shop === game.shop && oid === game.objectId) {
        setTransferProgress(progress);
        if (details) {
          setTransferSpeed(details.speed);
          setTransferETA(details.eta);
        }
      }
    };
    (window.electron as any).on("on-game-transfer-progress", onProgress);
    return () => (window.electron as any).off("on-game-transfer-progress", onProgress);
  }, [game]);

  const debounceUpdateLaunchOptions = useRef(
    debounce(async (value: string) => {
      const gameKey = getGameKey(game.shop, game.objectId);
      const gameData = (await levelDBService.get(gameKey, "games")) as Game | null;
      if (gameData) {
        const trimmed = value.trim();
        await levelDBService.put(gameKey, { ...gameData, launchOptions: trimmed || null }, "games");
      }
      updateGame();
    }, 1000)
  ).current;

  const handleRemoveGameFromLibrary = async () => {
    if (isGameDownloading) await cancelDownload(game.shop, game.objectId);
    await removeGameFromLibrary(game.shop, game.objectId);
    await Promise.all([updateGame(), updateLibrary(), loadCollections()]);
    onClose();
    if (game.shop === "custom" && onNavigateHome) onNavigateHome();
  };

  const handleCancelTransfer = () => {
    window.electron.cancelGameTransfer?.(game.shop, game.objectId);
    setTransferProgress(0);
    setTransferSpeed(0);
    setTransferETA(0);
    setShowCancelConfirm(false);
  };

  const handleStartTransfer = async (destPath: string) => {
    const result = await window.electron.transferGameFiles(game.shop, game.objectId, destPath);
    if (!result.ok) {
      showErrorToast(result.error || `Transfer failed for ${game.title}`);
      throw new Error(result.error);
    }
    showSuccessToast(`${game.title} moved successfully!`);
  };

  const handleChangeExecutableLocation = async () => {
    const path = await selectGameExecutable();
    if (path) {
      const gameUsingPath = await window.electron.verifyExecutablePathInUse(path);
      if (gameUsingPath) {
        showErrorToast(t("executable_path_in_use", { game: gameUsingPath.title }));
        return;
      }
      window.electron.updateExecutablePath(game.shop, game.objectId, path).then(updateGame);
    }
  };

  const handleCreateSteamShortcut = async (options?: CreateSteamShortcutOptions) => {
    try {
      setCreatingSteamShortcut(true);
      await window.electron.createSteamShortcut(game.shop, game.objectId, options ?? {});
      showSuccessToast(t("create_shortcut_success"), t("you_might_need_to_restart_steam"));
      const exists = await window.electron.checkSteamShortcut(game.shop, game.objectId);
      setSteamShortcutExists(exists);
      updateGame();
    } catch (error: unknown) {
      logger.error("Failed to create Steam shortcut", error);
      showErrorToast(t("create_shortcut_error"));
    } finally {
      setCreatingSteamShortcut(false);
      setShowSteamShortcutModal(false);
    }
  };

  const handleDeleteSteamShortcut = async () => {
    try {
      setCreatingSteamShortcut(true);
      await window.electron.deleteSteamShortcut(game.shop, game.objectId);
      showSuccessToast(t("delete_shortcut_success"), t("you_might_need_to_restart_steam"));
      const exists = await window.electron.checkSteamShortcut(game.shop, game.objectId);
      setSteamShortcutExists(exists);
      updateGame();
    } catch (error: unknown) {
      logger.error("Failed to delete Steam shortcut", error);
      showErrorToast(t("delete_shortcut_error"));
    } finally { setCreatingSteamShortcut(false); }
  };

  const handleCreateShortcut = async (location: ShortcutLocation) => {
    window.electron.createGameShortcut(game.shop, game.objectId, location)
      .then((success: boolean) => success ? showSuccessToast(t("create_shortcut_success")) : showErrorToast(t("create_shortcut_error")))
      .catch(() => showErrorToast(t("create_shortcut_error")));
  };

  const handleOpenDownloadFolder = () => window.electron.openGameInstallerPath(game.shop, game.objectId);
  const handleDeleteGame = async () => { await removeGameInstaller(game.shop, game.objectId); updateGame(); };
  const handleOpenGameExecutablePath = () => window.electron.openGameExecutablePath(game.shop, game.objectId);
  const handleOpenSaveFolder = async () => { if (saveFolderPath) await window.electron.openGameSaveFolder(game.shop, game.objectId, saveFolderPath); };
  const handleClearExecutablePath = async () => { await window.electron.updateExecutablePath(game.shop, game.objectId, null); updateGame(); };

  const handleChangeWinePrefixPath = async () => {
    const defaultPath = await window.electron.getDefaultWinePrefixSelectionPath();
    const { filePaths } = await window.electron.showOpenDialog({ properties: ["openDirectory"], defaultPath: game?.winePrefixPath ?? defaultPath ?? "" });
    if (filePaths?.length) {
      try { await window.electron.selectGameWinePrefix(game.shop, game.objectId, filePaths[0]); await updateGame(); }
      catch { showErrorToast(t("invalid_wine_prefix_path"), t("invalid_wine_prefix_path_description")); }
    }
  };

  const handleClearWinePrefixPath = async () => { await window.electron.selectGameWinePrefix(game.shop, game.objectId, null); updateGame(); };
  const handleOpenWinetricks = async () => {
    const success = await window.electron.openGameWinetricks(game.shop, game.objectId);
    success ? showSuccessToast(t("winetricks_opened")) : showErrorToast(t("winetricks_open_error"));
  };

  const handleChangeMangohudState = async (value: boolean) => { setAutoRunMangohud(value); await window.electron.toggleGameMangohud(game.shop, game.objectId, value); updateGame(); };
  const handleChangeGamemodeState = async (value: boolean) => { setAutoRunGamemode(value); await window.electron.toggleGameGamemode(game.shop, game.objectId, value); updateGame(); };

  const applyProtonPathChange = async (protonPath: string) => {
    try { await window.electron.selectGameProtonPath(game.shop, game.objectId, protonPath || null); await updateGame(); }
    catch { setSelectedProtonPath(game.protonPath ?? ""); showErrorToast(t("proton_version_update_error")); }
  };

  const handleChangeLaunchOptions = (event: React.ChangeEvent<HTMLInputElement>) => { const v = event.target.value; setLaunchOptions(v); debounceUpdateLaunchOptions(v); };
  const handleChangeGameTitle = (event: React.ChangeEvent<HTMLInputElement>) => setGameTitle(event.target.value);

  const handleBlurGameTitle = async () => {
    if (updatingGameTitle) return;
    const trimmed = gameTitle.trim();
    if (!trimmed) { setGameTitle(game.title ?? ""); showErrorToast(t("edit_game_modal_fill_required")); return; }
    if (trimmed === (game.title ?? "").trim()) { setGameTitle(game.title ?? ""); return; }
    setUpdatingGameTitle(true);
    try {
      if (game.shop === "custom") {
        await window.electron.updateCustomGame({ shop: game.shop, objectId: game.objectId, title: trimmed, iconUrl: game.iconUrl || undefined, logoImageUrl: game.logoImageUrl || undefined, libraryHeroImageUrl: game.libraryHeroImageUrl || undefined });
      } else {
        await window.electron.updateGameCustomAssets({ shop: game.shop, objectId: game.objectId, title: trimmed });
      }
      await Promise.all([updateGame(), updateLibrary()]);
      setGameTitle(trimmed);
    } catch (error) {
      setGameTitle(game.title ?? "");
      showErrorToast(error instanceof Error ? error.message : t("edit_game_modal_failed"));
    } finally { setUpdatingGameTitle(false); }
  };

  const handleChangeProtonVersion = (value: string) => { setSelectedProtonPath(value); if (value !== (game.protonPath ?? "")) applyProtonPathChange(value); };

  const handleClearLaunchOptions = async () => {
    setLaunchOptions("");
    const gameKey = getGameKey(game.shop, game.objectId);
    const gameData = (await levelDBService.get(gameKey, "games")) as Game | null;
    if (gameData) await levelDBService.put(gameKey, { ...gameData, launchOptions: null }, "games");
    updateGame();
  };

  const shouldShowWinePrefixConfiguration = window.electron.platform === "linux";
  const defaultHydraWinePrefixPath = defaultWinePrefixPath ? `${defaultWinePrefixPath}/${game.objectId}` : null;
  const displayedWinePrefixPath = game.winePrefixPath ?? defaultHydraWinePrefixPath;

  const categories = useMemo(() => [
    { id: "general" as const, label: t("settings_category_general"), icon: <GearIcon size={16} /> },
    { id: "assets" as const, label: t("settings_category_assets"), icon: <ImageIcon size={16} /> },
    { id: "hydra_cloud" as const, label: t("settings_category_hydra_cloud"), icon: <CloudIcon size={16} /> },
    ...(shouldShowWinePrefixConfiguration ? [{ id: "compatibility" as const, label: t("settings_category_compatibility"), icon: <Wrench size={16} /> }] : []),
    { id: "downloads" as const, label: t("settings_category_downloads"), icon: <DownloadIcon size={16} /> },
    { id: "danger_zone" as const, label: t("settings_category_danger_zone"), icon: <AlertIcon size={16} /> },
  ], [shouldShowWinePrefixConfiguration, t]);

  useEffect(() => { if (visible) setSelectedCategory(initialCategory ?? "general"); }, [initialCategory, visible]);
  const shouldShowCreateStartMenuShortcut = window.electron.platform === "win32";

  const handleResetAchievements = async () => {
    setIsDeletingAchievements(true);
    try { await window.electron.resetGameAchievements(game.shop, game.objectId); await updateGame(); showSuccessToast(t("reset_achievements_success")); }
    catch { showErrorToast(t("reset_achievements_error")); }
    finally { setIsDeletingAchievements(false); }
  };

  const handleChangePlaytime = async (sec: number) => {
    try { await window.electron.changeGamePlayTime(game.shop, game.objectId, sec); await updateGame(); showSuccessToast(t("update_playtime_success")); }
    catch { showErrorToast(t("update_playtime_error")); }
  };

  const handleToggleAutomaticCloudSync = async (event: React.ChangeEvent<HTMLInputElement>) => {
    setAutomaticCloudSync(event.target.checked);
    const gameKey = getGameKey(game.shop, game.objectId);
    const gameData = (await levelDBService.get(gameKey, "games")) as Game | null;
    if (gameData) await levelDBService.put(gameKey, { ...gameData, automaticCloudSync: event.target.checked }, "games");
    updateGame();
  };

  return (
    <>
      <DeleteGameModal visible={showDeleteModal} onClose={() => setShowDeleteModal(false)} deleteGame={handleDeleteGame} />
      <RemoveGameFromLibraryModal visible={showRemoveGameModal} onClose={() => setShowRemoveGameModal(false)} removeGameFromLibrary={handleRemoveGameFromLibrary} game={game} />
      <ResetAchievementsModal visible={showResetAchievementsModal} onClose={() => setShowResetAchievementsModal(false)} resetAchievements={handleResetAchievements} game={game} />
      <ChangeGamePlaytimeModal visible={showChangePlaytimeModal} onClose={() => setShowChangePlaytimeModal(false)} changePlaytime={handleChangePlaytime} game={game} />
      <CreateSteamShortcutModal visible={showSteamShortcutModal} creating={creatingSteamShortcut} onClose={() => setShowSteamShortcutModal(false)} onConfirm={handleCreateSteamShortcut} />

      <Modal visible={visible} title={game.title} onClose={onClose} large={true} noContentPadding>
        <div className="game-options-modal__container">
          <GameOptionsSidebar categories={categories} selectedCategory={selectedCategory} onSelectCategory={setSelectedCategory} />
          <div className="game-options-modal__panel">
            {selectedCategory === "general" && (
              <GeneralSettingsSection
                game={game}
                gameTitle={gameTitle}
                launchOptions={launchOptions}
                updatingGameTitle={updatingGameTitle}
                creatingSteamShortcut={creatingSteamShortcut}
                shouldShowCreateStartMenuShortcut={shouldShowCreateStartMenuShortcut}
                shouldShowWinePrefixConfiguration={shouldShowWinePrefixConfiguration}
                loadingSaveFolder={loadingSaveFolder}
                saveFolderPath={saveFolderPath}
                steamShortcutExists={steamShortcutExists}
                onChangeExecutableLocation={handleChangeExecutableLocation}
                onClearExecutablePath={handleClearExecutablePath}
                onOpenGameExecutablePath={handleOpenGameExecutablePath}
                onOpenSaveFolder={handleOpenSaveFolder}
                onCreateShortcut={handleCreateShortcut}
                onCreateSteamShortcut={() => setShowSteamShortcutModal(true)}
                onDeleteSteamShortcut={handleDeleteSteamShortcut}
                onChangeGameTitle={handleChangeGameTitle}
                onBlurGameTitle={handleBlurGameTitle}
                onChangeLaunchOptions={handleChangeLaunchOptions}
                onClearLaunchOptions={handleClearLaunchOptions}
                isTransferring={isTransferring}
                transferProgress={transferProgress}
                drives={drives}
                onStartTransfer={handleStartTransfer}
                onCancelDriveSelection={() => {}}
                transferSpeed={transferSpeed}
                transferETA={transferETA}
                showCancelConfirm={showCancelConfirm}
                onShowCancelConfirm={() => setShowCancelConfirm(true)}
                onHideCancelConfirm={() => setShowCancelConfirm(false)}
                onConfirmCancelTransfer={handleCancelTransfer}
              />
            )}
            {selectedCategory === "assets" && <GameAssetsSettings game={game} shopDetails={shopDetails} onGameUpdated={updateGame} />}
            {selectedCategory === "hydra_cloud" && <HydraCloudSettingsSection game={game} automaticCloudSync={automaticCloudSync} onToggleAutomaticCloudSync={handleToggleAutomaticCloudSync} />}
            {selectedCategory === "compatibility" && shouldShowWinePrefixConfiguration && (
              <CompatibilitySettingsSection game={game} displayedWinePrefixPath={displayedWinePrefixPath} protonVersions={protonVersions} selectedProtonPath={selectedProtonPath}
                autoRunGamemode={autoRunGamemode} autoRunMangohud={autoRunMangohud} globalAutoRunGamemode={globalAutoRunGamemode} globalAutoRunMangohud={globalAutoRunMangohud}
                gamemodeAvailable={gamemodeAvailable} mangohudAvailable={mangohudAvailable} winetricksAvailable={winetricksAvailable}
                gamemodeSiteUrl={GAMEMODE_SITE_URL} mangohudSiteUrl={MANGOHUD_SITE_URL}
                onChangeWinePrefixPath={handleChangeWinePrefixPath} onClearWinePrefixPath={handleClearWinePrefixPath} onOpenWinetricks={handleOpenWinetricks}
                onChangeGamemodeState={handleChangeGamemodeState} onChangeMangohudState={handleChangeMangohudState} onChangeProtonVersion={handleChangeProtonVersion} />
            )}
            {selectedCategory === "downloads" && <DownloadsSettingsSection game={game} deleting={deleting} isGameDownloading={isGameDownloading} repacksLength={repacks.length} onOpenRepacks={() => setShowRepacksModal(true)} onOpenDownloadFolder={handleOpenDownloadFolder} />}
            {selectedCategory === "danger_zone" && (
              <DangerZoneSection game={game} deleting={deleting} isDeletingAchievements={isDeletingAchievements} hasAchievements={hasAchievements} isGameDownloading={isGameDownloading} userDetails={userDetails}
                onOpenRemoveFromLibrary={() => setShowRemoveGameModal(true)} onOpenResetAchievements={() => setShowResetAchievementsModal(true)}
                onOpenChangePlaytime={() => setShowChangePlaytimeModal(true)} onOpenRemoveFiles={() => setShowDeleteModal(true)} />
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}