import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Button,
  CheckboxField,
  Link,
  Modal,
  ProtonPathPicker,
  TextField,
} from "@renderer/components";
import type {
  Game,
  LibraryGame,
  ProtonVersion,
  ShortcutLocation,
} from "@types";
import { gameDetailsContext } from "@renderer/context";
import { DeleteGameModal } from "@renderer/pages/downloads/delete-game-modal";
import { useDownload, useToast, useUserDetails } from "@renderer/hooks";
import { RemoveGameFromLibraryModal } from "./remove-from-library-modal";
import { ResetAchievementsModal } from "./reset-achievements-modal";
import { ChangeGamePlaytimeModal } from "./change-game-playtime-modal";
import {
  AlertIcon,
  CloudIcon,
  DownloadIcon,
  FileDirectoryIcon,
  FileIcon,
  GearIcon,
  ImageIcon,
  LinkExternalIcon,
} from "@primer/octicons-react";
import { Wrench } from "lucide-react";
import { Tooltip } from "react-tooltip";
import { GameAssetsSettings } from "./game-assets-settings";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import { debounce } from "lodash-es";
import { levelDBService } from "@renderer/services/leveldb.service";
import { getGameKey } from "@renderer/helpers";
import "./game-options-modal.scss";
import { logger } from "@renderer/logger";
import { CloudSyncPanel } from "../cloud-sync/cloud-sync-panel";

export interface GameOptionsModalProps {
  visible: boolean;
  game: LibraryGame;
  onClose: () => void;
  onNavigateHome?: () => void;
  initialCategory?: GameSettingsCategoryId;
}

type GameSettingsCategoryId =
  | "general"
  | "assets"
  | "hydra_cloud"
  | "compatibility"
  | "downloads"
  | "danger_zone";

export function GameOptionsModal({
  visible,
  game,
  onClose,
  onNavigateHome,
  initialCategory,
}: Readonly<GameOptionsModalProps>) {
  const MANGOHUD_SITE_URL = "https://mangohud.com";
  const { t } = useTranslation("game_details");

  const { showSuccessToast, showErrorToast } = useToast();

  const {
    updateGame,
    setShowRepacksModal,
    repacks,
    selectGameExecutable,
    achievements,
    shopDetails,
  } = useContext(gameDetailsContext);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRemoveGameModal, setShowRemoveGameModal] = useState(false);
  const [launchOptions, setLaunchOptions] = useState(game.launchOptions ?? "");
  const [showResetAchievementsModal, setShowResetAchievementsModal] =
    useState(false);
  const [showChangePlaytimeModal, setShowChangePlaytimeModal] = useState(false);
  const [isDeletingAchievements, setIsDeletingAchievements] = useState(false);
  const [automaticCloudSync, setAutomaticCloudSync] = useState(
    game.automaticCloudSync ?? false
  );
  const [creatingSteamShortcut, setCreatingSteamShortcut] = useState(false);
  const [saveFolderPath, setSaveFolderPath] = useState<string | null>(null);
  const [loadingSaveFolder, setLoadingSaveFolder] = useState(false);
  const [protonVersions, setProtonVersions] = useState<ProtonVersion[]>([]);
  const [selectedProtonPath, setSelectedProtonPath] = useState(
    game.protonPath ?? ""
  );
  const [autoRunMangohud, setAutoRunMangohud] = useState(
    game.autoRunMangohud ?? false
  );
  const [mangohudAvailable, setMangohudAvailable] = useState(false);
  const [winetricksAvailable, setWinetricksAvailable] = useState(false);
  const [selectedCategory, setSelectedCategory] =
    useState<GameSettingsCategoryId>("general");
  const [defaultWinePrefixPath, setDefaultWinePrefixPath] = useState<
    string | null
  >(null);

  const {
    removeGameInstaller,
    removeGameFromLibrary,
    isGameDeleting,
    cancelDownload,
  } = useDownload();

  const { userDetails } = useUserDetails();

  const hasAchievements =
    (achievements?.filter((achievement) => achievement.unlocked).length ?? 0) >
    0;

  const deleting = isGameDeleting(game.id);

  const { lastPacket } = useDownload();

  const isGameDownloading =
    game.download?.status === "active" && lastPacket?.gameId === game.id;

  useEffect(() => {
    if (
      visible &&
      game.shop !== "custom" &&
      window.electron.platform === "win32"
    ) {
      setLoadingSaveFolder(true);
      setSaveFolderPath(null);
      window.electron
        .getGameSaveFolder(game.shop, game.objectId)
        .then(setSaveFolderPath)
        .catch(() => setSaveFolderPath(null))
        .finally(() => setLoadingSaveFolder(false));
    }
  }, [visible, game.shop, game.objectId]);

  useEffect(() => {
    setSelectedProtonPath(game.protonPath ?? "");
  }, [game.protonPath]);

  useEffect(() => {
    setAutoRunMangohud(game.autoRunMangohud ?? false);
  }, [game.autoRunMangohud]);

  useEffect(() => {
    if (!visible || window.electron.platform !== "linux") return;

    window.electron
      .getInstalledProtonVersions()
      .then(setProtonVersions)
      .catch(() => setProtonVersions([]));
  }, [visible]);

  useEffect(() => {
    if (!visible || window.electron.platform !== "linux") return;

    window.electron
      .getDefaultWinePrefixSelectionPath()
      .then((defaultPath) => setDefaultWinePrefixPath(defaultPath))
      .catch(() => setDefaultWinePrefixPath(null));
  }, [visible]);

  useEffect(() => {
    if (!visible || window.electron.platform !== "linux") {
      setMangohudAvailable(false);
      return;
    }

    window.electron
      .isMangohudAvailable()
      .then(setMangohudAvailable)
      .catch(() => setMangohudAvailable(false));
  }, [visible]);

  useEffect(() => {
    if (!visible || window.electron.platform !== "linux") {
      setWinetricksAvailable(false);
      return;
    }

    window.electron
      .isWinetricksAvailable()
      .then(setWinetricksAvailable)
      .catch(() => setWinetricksAvailable(false));
  }, [visible]);

  const debounceUpdateLaunchOptions = useRef(
    debounce(async (value: string) => {
      const gameKey = getGameKey(game.shop, game.objectId);
      const gameData = (await levelDBService.get(
        gameKey,
        "games"
      )) as Game | null;
      if (gameData) {
        const trimmedValue = value.trim();
        const updated = {
          ...gameData,
          launchOptions: trimmedValue ? trimmedValue : null,
        };
        await levelDBService.put(gameKey, updated, "games");
      }
      updateGame();
    }, 1000)
  ).current;

  const handleRemoveGameFromLibrary = async () => {
    if (isGameDownloading) {
      await cancelDownload(game.shop, game.objectId);
    }

    await removeGameFromLibrary(game.shop, game.objectId);
    updateGame();
    onClose();

    // Redirect to home page if it's a custom game
    if (game.shop === "custom" && onNavigateHome) {
      onNavigateHome();
    }
  };

  const handleChangeExecutableLocation = async () => {
    const path = await selectGameExecutable();

    if (path) {
      const gameUsingPath =
        await window.electron.verifyExecutablePathInUse(path);

      if (gameUsingPath) {
        showErrorToast(
          t("executable_path_in_use", { game: gameUsingPath.title })
        );
        return;
      }

      window.electron
        .updateExecutablePath(game.shop, game.objectId, path)
        .then(updateGame);
    }
  };

  const handleCreateSteamShortcut = async () => {
    try {
      setCreatingSteamShortcut(true);
      await window.electron.createSteamShortcut(game.shop, game.objectId);

      showSuccessToast(
        t("create_shortcut_success"),
        t("you_might_need_to_restart_steam")
      );

      updateGame();
    } catch (error: unknown) {
      logger.error("Failed to create Steam shortcut", error);
      showErrorToast(t("create_shortcut_error"));
    } finally {
      setCreatingSteamShortcut(false);
    }
  };

  const handleCreateShortcut = async (location: ShortcutLocation) => {
    window.electron
      .createGameShortcut(game.shop, game.objectId, location)
      .then((success) => {
        if (success) {
          showSuccessToast(t("create_shortcut_success"));
        } else {
          showErrorToast(t("create_shortcut_error"));
        }
      })
      .catch(() => {
        showErrorToast(t("create_shortcut_error"));
      });
  };

  const handleOpenDownloadFolder = async () => {
    await window.electron.openGameInstallerPath(game.shop, game.objectId);
  };

  const handleDeleteGame = async () => {
    await removeGameInstaller(game.shop, game.objectId);
    updateGame();
  };

  const handleOpenGameExecutablePath = async () => {
    await window.electron.openGameExecutablePath(game.shop, game.objectId);
  };

  const handleOpenSaveFolder = async () => {
    if (saveFolderPath) {
      await window.electron.openGameSaveFolder(
        game.shop,
        game.objectId,
        saveFolderPath
      );
    }
  };

  const handleClearExecutablePath = async () => {
    await window.electron.updateExecutablePath(game.shop, game.objectId, null);

    updateGame();
  };

  const handleChangeWinePrefixPath = async () => {
    const defaultPath =
      await window.electron.getDefaultWinePrefixSelectionPath();

    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
      defaultPath: game?.winePrefixPath ?? defaultPath ?? "",
    });

    if (filePaths && filePaths.length > 0) {
      try {
        await window.electron.selectGameWinePrefix(
          game.shop,
          game.objectId,
          filePaths[0]
        );
        await updateGame();
      } catch (error) {
        showErrorToast(
          t("invalid_wine_prefix_path"),
          t("invalid_wine_prefix_path_description")
        );
      }
    }
  };

  const handleClearWinePrefixPath = async () => {
    await window.electron.selectGameWinePrefix(game.shop, game.objectId, null);
    updateGame();
  };

  const handleOpenWinetricks = async () => {
    const success = await window.electron.openGameWinetricks(
      game.shop,
      game.objectId
    );

    if (success) {
      showSuccessToast(t("winetricks_opened"));
    } else {
      showErrorToast(t("winetricks_open_error"));
    }
  };

  const handleToggleMangohud = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const enabled = event.target.checked;
    setAutoRunMangohud(enabled);
    await window.electron.toggleGameMangohud(game.shop, game.objectId, enabled);
    updateGame();
  };

  const handleChangeLaunchOptions = async (event) => {
    const value = event.target.value;

    setLaunchOptions(value);
    debounceUpdateLaunchOptions(value);
  };

  const handleClearLaunchOptions = async () => {
    setLaunchOptions("");

    const gameKey = getGameKey(game.shop, game.objectId);
    const gameData = (await levelDBService.get(
      gameKey,
      "games"
    )) as Game | null;
    if (gameData) {
      const updated = { ...gameData, launchOptions: null };
      await levelDBService.put(gameKey, updated, "games");
    }
    updateGame();
  };

  const shouldShowWinePrefixConfiguration =
    window.electron.platform === "linux";
  const displayedWinePrefixPath = game.winePrefixPath ?? defaultWinePrefixPath;

  const categories = useMemo(
    () => [
      {
        id: "general" as const,
        label: t("settings_category_general"),
        icon: <GearIcon size={16} />,
      },
      {
        id: "assets" as const,
        label: t("settings_category_assets"),
        icon: <ImageIcon size={16} />,
      },
      {
        id: "hydra_cloud" as const,
        label: t("settings_category_hydra_cloud"),
        icon: <CloudIcon size={16} />,
      },
      ...(shouldShowWinePrefixConfiguration
        ? [
            {
              id: "compatibility" as const,
              label: t("settings_category_compatibility"),
              icon: <Wrench size={16} />,
            },
          ]
        : []),
      {
        id: "downloads" as const,
        label: t("settings_category_downloads"),
        icon: <DownloadIcon size={16} />,
      },
      {
        id: "danger_zone" as const,
        label: t("settings_category_danger_zone"),
        icon: <AlertIcon size={16} />,
      },
    ],
    [shouldShowWinePrefixConfiguration, t]
  );

  useEffect(() => {
    if (visible) {
      setSelectedCategory(initialCategory ?? "general");
    }
  }, [initialCategory, visible]);

  const shouldShowCreateStartMenuShortcut =
    window.electron.platform === "win32";
  const showWinetricksUnavailableTooltip = !winetricksAvailable;

  const handleResetAchievements = async () => {
    setIsDeletingAchievements(true);
    try {
      await window.electron.resetGameAchievements(game.shop, game.objectId);
      await updateGame();
      showSuccessToast(t("reset_achievements_success"));
    } catch (error) {
      showErrorToast(t("reset_achievements_error"));
    } finally {
      setIsDeletingAchievements(false);
    }
  };

  const handleChangePlaytime = async (playtimeInSeconds: number) => {
    try {
      await window.electron.changeGamePlayTime(
        game.shop,
        game.objectId,
        playtimeInSeconds
      );
      await updateGame();
      showSuccessToast(t("update_playtime_success"));
    } catch (error) {
      showErrorToast(t("update_playtime_error"));
    }
  };

  const handleToggleAutomaticCloudSync = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setAutomaticCloudSync(event.target.checked);

    const gameKey = getGameKey(game.shop, game.objectId);
    const gameData = (await levelDBService.get(
      gameKey,
      "games"
    )) as Game | null;
    if (gameData) {
      const updated = { ...gameData, automaticCloudSync: event.target.checked };
      await levelDBService.put(gameKey, updated, "games");
    }

    updateGame();
  };

  return (
    <>
      <DeleteGameModal
        visible={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        deleteGame={handleDeleteGame}
      />

      <RemoveGameFromLibraryModal
        visible={showRemoveGameModal}
        onClose={() => setShowRemoveGameModal(false)}
        removeGameFromLibrary={handleRemoveGameFromLibrary}
        game={game}
      />

      <ResetAchievementsModal
        visible={showResetAchievementsModal}
        onClose={() => setShowResetAchievementsModal(false)}
        resetAchievements={handleResetAchievements}
        game={game}
      />

      <ChangeGamePlaytimeModal
        visible={showChangePlaytimeModal}
        onClose={() => setShowChangePlaytimeModal(false)}
        changePlaytime={handleChangePlaytime}
        game={game}
      />

      <Modal
        visible={visible}
        title={game.title}
        onClose={onClose}
        large={true}
        noContentPadding
      >
        <div className="game-options-modal__container">
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
                onClick={() => setSelectedCategory(category.id)}
              >
                <span className="game-options-modal__sidebar-button-icon">
                  {category.icon}
                </span>
                <span>{category.label}</span>
              </button>
            ))}
          </aside>

          <div className="game-options-modal__panel">
            {selectedCategory === "general" && (
              <>
                <div className="game-options-modal__section">
                  <div className="game-options-modal__header">
                    <h2>{t("executable_section_title")}</h2>
                    <h4 className="game-options-modal__header-description">
                      {t("executable_section_description")}
                    </h4>
                  </div>

                  <div className="game-options-modal__executable-field">
                    <TextField
                      value={game.executablePath || ""}
                      readOnly
                      theme="dark"
                      disabled
                      placeholder={t("no_executable_selected")}
                      rightContent={
                        <>
                          <Button
                            type="button"
                            theme="outline"
                            onClick={handleChangeExecutableLocation}
                          >
                            <FileIcon />
                            {t("select_executable")}
                          </Button>
                          {game.executablePath && (
                            <Button
                              onClick={handleClearExecutablePath}
                              theme="outline"
                            >
                              {t("clear")}
                            </Button>
                          )}
                        </>
                      }
                    />

                    <div className="game-options-modal__executable-field-buttons">
                      {game.executablePath && (
                        <Button
                          type="button"
                          theme="outline"
                          onClick={handleOpenGameExecutablePath}
                        >
                          {t("open_folder")}
                        </Button>
                      )}
                      {game.shop !== "custom" &&
                        window.electron.platform === "win32" && (
                          <Button
                            type="button"
                            theme="outline"
                            onClick={handleOpenSaveFolder}
                            disabled={loadingSaveFolder || !saveFolderPath}
                          >
                            {loadingSaveFolder
                              ? t("searching_save_folder")
                              : saveFolderPath
                                ? t("open_save_folder")
                                : t("no_save_folder_found")}
                          </Button>
                        )}
                    </div>
                  </div>
                </div>

                {game.executablePath && (
                  <div className="game-options-modal__section">
                    <div className="game-options-modal__header">
                      <h2>{t("shortcuts_section_title")}</h2>
                      <h4 className="game-options-modal__header-description">
                        {t("shortcuts_section_description")}
                      </h4>
                    </div>

                    <div className="game-options-modal__row">
                      <Button
                        onClick={() => handleCreateShortcut("desktop")}
                        theme="outline"
                      >
                        {t("create_shortcut")}
                      </Button>
                      {game.shop !== "custom" && (
                        <Button
                          onClick={handleCreateSteamShortcut}
                          theme="outline"
                          disabled={creatingSteamShortcut}
                        >
                          <SteamLogo />
                          {t("create_steam_shortcut")}
                        </Button>
                      )}
                      {shouldShowCreateStartMenuShortcut && (
                        <Button
                          onClick={() => handleCreateShortcut("start_menu")}
                          theme="outline"
                        >
                          {t("create_start_menu_shortcut")}
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                <div className="game-options-modal__launch-options">
                  <div className="game-options-modal__header">
                    <h2>{t("launch_options")}</h2>
                    <h4 className="game-options-modal__header-description">
                      {shouldShowWinePrefixConfiguration ? (
                        <Trans
                          i18nKey="launch_options_description_linux"
                          ns="game_details"
                          defaults="Add game launch arguments, or use <code>%command%</code> to wrap the launch command."
                          components={{
                            code: (
                              <code className="game-options-modal__inline-code" />
                            ),
                          }}
                        />
                      ) : (
                        t("launch_options_description")
                      )}
                    </h4>
                  </div>

                  <TextField
                    value={launchOptions}
                    theme="dark"
                    placeholder={t("launch_options_placeholder")}
                    onChange={handleChangeLaunchOptions}
                    rightContent={
                      game.launchOptions && (
                        <Button
                          onClick={handleClearLaunchOptions}
                          theme="outline"
                        >
                          {t("clear")}
                        </Button>
                      )
                    }
                  />
                </div>
              </>
            )}

            {selectedCategory === "assets" && (
              <GameAssetsSettings
                game={game}
                shopDetails={shopDetails}
                onGameUpdated={updateGame}
              />
            )}

            {selectedCategory === "hydra_cloud" &&
              (game.shop !== "custom" ? (
                <>
                  <div className="game-options-modal__cloud-panel">
                    <CloudSyncPanel
                      automaticCloudSync={automaticCloudSync}
                      onToggleAutomaticCloudSync={
                        handleToggleAutomaticCloudSync
                      }
                    />
                  </div>
                </>
              ) : (
                <p className="game-options-modal__category-note">
                  {t("settings_not_available_for_custom_games")}
                </p>
              ))}

            {selectedCategory === "compatibility" &&
              shouldShowWinePrefixConfiguration && (
                <>
                  <div className="game-options-modal__wine-prefix">
                    <div className="game-options-modal__header">
                      <h2>{t("wine_prefix")}</h2>
                      <h4 className="game-options-modal__header-description">
                        {t("wine_prefix_description")}
                      </h4>
                    </div>

                    <TextField
                      value={displayedWinePrefixPath || ""}
                      readOnly
                      theme="dark"
                      disabled
                      placeholder={t("no_directory_selected")}
                      rightContent={
                        <>
                          <Button
                            type="button"
                            theme="outline"
                            onClick={handleChangeWinePrefixPath}
                          >
                            <FileDirectoryIcon />
                            {t("select_executable")}
                          </Button>
                          {game.winePrefixPath && (
                            <Button
                              onClick={handleClearWinePrefixPath}
                              theme="outline"
                            >
                              {t("clear")}
                            </Button>
                          )}
                        </>
                      }
                    />

                    <div className="game-options-modal__row">
                      <span
                        className="game-options-modal__tool-button-wrapper"
                        data-tooltip-id="winetricks-unavailable-tooltip"
                        data-tooltip-content={
                          showWinetricksUnavailableTooltip
                            ? t("winetricks_not_available_tooltip")
                            : undefined
                        }
                      >
                        <Button
                          type="button"
                          theme="outline"
                          onClick={handleOpenWinetricks}
                          disabled={!winetricksAvailable}
                        >
                          {t("open_winetricks")}
                        </Button>
                      </span>

                      {showWinetricksUnavailableTooltip && (
                        <Tooltip id="winetricks-unavailable-tooltip" />
                      )}
                    </div>
                  </div>

                  <div className="game-options-modal__section">
                    <div className="game-options-modal__header">
                      <h2>{t("additional_options")}</h2>
                    </div>

                    <div className="game-options-modal__mangohud-toggle">
                      {!mangohudAvailable && (
                        <span
                          className="game-options-modal__mangohud-help"
                          data-tooltip-id="mangohud-unavailable-tooltip"
                          data-tooltip-content={t(
                            "mangohud_not_available_tooltip"
                          )}
                        >
                          (?)
                        </span>
                      )}

                      <CheckboxField
                        label={
                          <span className="game-options-modal__mangohud-label">
                            <span>{t("run_with_mangohud_prefix")}</span>
                            <Link
                              to={MANGOHUD_SITE_URL}
                              className="game-options-modal__mangohud-link"
                            >
                              MangoHud
                              <LinkExternalIcon />
                            </Link>
                          </span>
                        }
                        checked={autoRunMangohud}
                        disabled={!mangohudAvailable}
                        onChange={handleToggleMangohud}
                      />

                      {!mangohudAvailable && (
                        <Tooltip id="mangohud-unavailable-tooltip" />
                      )}
                    </div>
                  </div>

                  <div className="game-options-modal__section">
                    <div className="game-options-modal__header">
                      <h2>{t("proton_version")}</h2>
                      <h4 className="game-options-modal__header-description">
                        {t("proton_version_description")}
                      </h4>
                    </div>

                    <ProtonPathPicker
                      versions={protonVersions}
                      selectedPath={selectedProtonPath}
                      onChange={(value) => {
                        setSelectedProtonPath(value);
                        void window.electron
                          .selectGameProtonPath(
                            game.shop,
                            game.objectId,
                            value || null
                          )
                          .then(() => updateGame());
                      }}
                      radioName={`proton-version-${game.objectId}`}
                      autoLabel={t("proton_version_auto")}
                      autoSourceDescription={t("proton_source_umu_default")}
                      steamSourceDescription={t("proton_source_steam")}
                      compatibilityToolsSourceDescription={t(
                        "proton_source_compatibility_tools"
                      )}
                    />
                  </div>
                </>
              )}

            {selectedCategory === "downloads" &&
              (game.shop !== "custom" ? (
                <div className="game-options-modal__downloads">
                  <div className="game-options-modal__header">
                    <h2>{t("downloads_section_title")}</h2>
                    <h4 className="game-options-modal__header-description">
                      {t("downloads_section_description")}
                    </h4>
                  </div>

                  <div className="game-options-modal__row">
                    <Button
                      onClick={() => setShowRepacksModal(true)}
                      theme="outline"
                      disabled={
                        deleting || isGameDownloading || !repacks.length
                      }
                    >
                      {t("open_download_options")}
                    </Button>
                    {game.download?.downloadPath && (
                      <Button
                        onClick={handleOpenDownloadFolder}
                        theme="outline"
                        disabled={deleting}
                      >
                        {t("open_download_location")}
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="game-options-modal__category-note">
                  {t("settings_not_available_for_custom_games")}
                </p>
              ))}

            {selectedCategory === "danger_zone" && (
              <div className="game-options-modal__danger-zone">
                <div className="game-options-modal__header">
                  <h2>{t("danger_zone_section_title")}</h2>
                  <h4 className="game-options-modal__danger-zone-description">
                    {t("danger_zone_section_description")}
                  </h4>
                </div>

                <div className="game-options-modal__danger-zone-buttons">
                  <Button
                    onClick={() => setShowRemoveGameModal(true)}
                    theme="danger"
                    disabled={deleting}
                  >
                    {t("remove_from_library")}
                  </Button>

                  {game.shop !== "custom" && (
                    <Button
                      onClick={() => setShowResetAchievementsModal(true)}
                      theme="danger"
                      disabled={
                        deleting ||
                        isDeletingAchievements ||
                        !hasAchievements ||
                        !userDetails
                      }
                    >
                      {t("reset_achievements")}
                    </Button>
                  )}

                  <Button
                    onClick={() => setShowChangePlaytimeModal(true)}
                    theme="danger"
                  >
                    {t("update_game_playtime")}
                  </Button>

                  {game.shop !== "custom" && (
                    <Button
                      onClick={() => {
                        setShowDeleteModal(true);
                      }}
                      theme="danger"
                      disabled={
                        isGameDownloading ||
                        deleting ||
                        !game.download?.downloadPath
                      }
                    >
                      {t("remove_files")}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
