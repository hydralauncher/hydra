import { Trans, useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Button, TextField } from "@renderer/components";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import type { LibraryGame, ShortcutLocation } from "@types";
import { FileIcon } from "@primer/octicons-react";
import { HardDrive, Pause, Play, X } from "lucide-react";
import "./general-section.scss";

interface DriveInfo {
  root: string;
  label: string;
  free: number;
  total: number;
}

interface GeneralSettingsSectionProps {
  game: LibraryGame;
  gameTitle: string;
  launchOptions: string;
  updatingGameTitle: boolean;
  creatingSteamShortcut: boolean;
  shouldShowCreateStartMenuShortcut: boolean;
  shouldShowWinePrefixConfiguration: boolean;
  loadingSaveFolder: boolean;
  saveFolderPath: string | null;
  steamShortcutExists: boolean;
  onChangeExecutableLocation: () => Promise<void>;
  onClearExecutablePath: () => Promise<void>;
  onOpenGameExecutablePath: () => Promise<void>;
  onOpenSaveFolder: () => Promise<void>;
  onCreateShortcut: (location: ShortcutLocation) => Promise<void>;
  onCreateSteamShortcut: () => void;
  onDeleteSteamShortcut: () => Promise<void>;
  onChangeGameTitle: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onBlurGameTitle: () => Promise<void>;
  onChangeLaunchOptions: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClearLaunchOptions: () => Promise<void>;
  onTransferGame: (destPath: string) => void | Promise<void>;
  isTransferring: boolean;
  transferProgress: number;
  isPaused: boolean;
  onPauseTransfer: () => void;
  onResumeTransfer: () => void;
  onCancelTransfer: () => void;
  drives: DriveInfo[];
  onStartTransfer: (destPath: string) => Promise<void>;
  onCancelDriveSelection: () => void;
}

function fmt(b: number) {
  if (b >= 1e12) return (b / 1e12).toFixed(1) + " TB";
  if (b >= 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  return (b / 1e3).toFixed(0) + " KB";
}

export function GeneralSettingsSection({
  game,
  gameTitle,
  launchOptions,
  updatingGameTitle,
  creatingSteamShortcut,
  shouldShowCreateStartMenuShortcut,
  shouldShowWinePrefixConfiguration,
  loadingSaveFolder,
  saveFolderPath,
  steamShortcutExists,
  onChangeExecutableLocation,
  onClearExecutablePath,
  onOpenGameExecutablePath,
  onOpenSaveFolder,
  onCreateShortcut,
  onCreateSteamShortcut,
  onDeleteSteamShortcut,
  onChangeGameTitle,
  onBlurGameTitle,
  onChangeLaunchOptions,
  onClearLaunchOptions,
  isTransferring,
  transferProgress,
  isPaused,
  onPauseTransfer,
  onResumeTransfer,
  onCancelTransfer,
  drives,
  onStartTransfer,
  onCancelDriveSelection,
}: Readonly<GeneralSettingsSectionProps>) {
  const { t } = useTranslation("game_details");

  const [showDriveSelector, setShowDriveSelector] = useState(false);
  const [selectedDrive, setSelectedDrive] = useState<string | null>(null);
  const [customPath, setCustomPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);

  const gameSize = game.installedSizeInBytes ?? 0;
  const progressPercent = Math.round(transferProgress * 100);
  const transferredBytes = gameSize * transferProgress;

  useEffect(() => {
    if (isTransferring) setShowDriveSelector(false);
  }, [isTransferring]);

  const getDriveRoot = (p: string) => {
    const m = p.match(/^[A-Za-z]:\\/);
    return m ? m[0] : null;
  };

  const handleStartTransfer = async () => {
    const dest = selectedDrive || customPath.trim();
    if (!dest) {
      setError(t("select_destination"));
      return;
    }

    // Only create "Hydra Games" folder if a drive was selected (not custom path)
    let fullDest: string;
    const isDriveSelected = selectedDrive !== null;
    
    if (isDriveSelected) {
      // Drive selected: create Hydra Games folder
      const hydraFolder = "Hydra Games";
      fullDest = `${dest}\\${hydraFolder}`;
    } else {
      // Custom path: use exactly as entered
      fullDest = dest;
    }

    setError(null);
    setIsPreparing(true);

    try {
      await onStartTransfer(fullDest);
      setShowDriveSelector(false);
      setSelectedDrive(null);
      setCustomPath("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("transfer_failed"));
    } finally {
      setIsPreparing(false);
    }
  };

  const handleBrowse = async () => {
    const res = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (!res.canceled && res.filePaths[0]) {
      setCustomPath(res.filePaths[0]);
      setSelectedDrive(null);
      setError(null);
    }
  };

  const handleCancelSelector = () => {
    setShowDriveSelector(false);
    setSelectedDrive(null);
    setCustomPath("");
    setError(null);
    onCancelDriveSelection();
  };

  const effectiveDest = selectedDrive || customPath.trim();

  return (
    <>
      {/* Title */}
      <div className="game-options-modal__section">
        <TextField
          label={t("edit_game_modal_title")}
          placeholder={t("edit_game_modal_enter_title")}
          value={gameTitle}
          onChange={onChangeGameTitle}
          onBlur={() => void onBlurGameTitle()}
          theme="dark"
          disabled={updatingGameTitle}
        />
      </div>

      {/* Executable */}
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
                  onClick={onChangeExecutableLocation}
                >
                  <FileIcon />
                  {t("select_executable")}
                </Button>
                {game.executablePath && (
                  <Button onClick={onClearExecutablePath} theme="outline">
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
                onClick={onOpenGameExecutablePath}
              >
                {t("open_folder")}
              </Button>
            )}
            {game.shop !== "custom" && window.electron.platform === "win32" && (
              <Button
                type="button"
                theme="outline"
                onClick={onOpenSaveFolder}
                disabled={loadingSaveFolder || !saveFolderPath}
              >
                {loadingSaveFolder
                  ? t("searching_save_folder")
                  : saveFolderPath
                    ? t("open_save_folder")
                    : t("no_save_folder_found")}
              </Button>
            )}
            {game.executablePath && !isTransferring && !showDriveSelector && (
              <Button
                type="button"
                theme="danger"
                onClick={() => setShowDriveSelector(true)}
              >
                {t("transfer_game")}
              </Button>
            )}
          </div>

          {/* Drive selector */}
          {showDriveSelector && !isTransferring && (
            <div className="drive-selector">
              <p className="drive-selector__title">
                {t("select_destination_for", { game: game.title })}
              </p>

              {drives.length > 0 && (
                <div className="drive-selector__list">
                  {drives.map((drive) => {
                    const hasSpace = drive.free >= gameSize;
                    const isSelected =
                      selectedDrive === drive.root && !customPath;
                    const usedPct = Math.round(
                      ((drive.total - drive.free) / drive.total) * 100
                    );
                    const gamePct =
                      gameSize > 0
                        ? Math.min(
                            (gameSize / drive.total) * 100,
                            100 - usedPct
                          )
                        : 0;

                    return (
                      <button
                        key={drive.root}
                        type="button"
                        className={[
                          "drive-card",
                          isSelected && "drive-card--selected",
                          !hasSpace && "drive-card--nospace",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => {
                          if (!hasSpace) return;
                          setSelectedDrive(drive.root);
                          setCustomPath("");
                          setError(null);
                        }}
                        disabled={!hasSpace}
                      >
                        <HardDrive size={18} className="drive-card__icon" />
                        <div className="drive-card__body">
                          <div className="drive-card__top">
                            <span className="drive-card__label">
                              {drive.label || drive.root}
                            </span>
                            <span className="drive-card__space">
                              {fmt(drive.free)} {t("free_of")}{" "}
                              {fmt(drive.total)}
                            </span>
                          </div>
                          <div className="drive-card__bar">
                            <div
                              className="drive-card__bar-used"
                              style={{ width: `${usedPct}%` }}
                            />
                            {gamePct > 0 && (
                              <div
                                className="drive-card__bar-game"
                                style={{
                                  width: `${gamePct}%`,
                                  left: `${usedPct}%`,
                                }}
                              />
                            )}
                          </div>
                        </div>
                        {!hasSpace && (
                          <span className="drive-card__tag">
                            {t("no_space")}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="drive-selector__custom">
                <span className="drive-selector__or">{t("or_enter_path")}</span>
                <div className="drive-selector__path-row">
                  <TextField
                    value={customPath}
                    onChange={(e) => {
                      setCustomPath(e.target.value);
                      setSelectedDrive(null);
                      setError(null);
                    }}
                    placeholder={t("destination_folder_placeholder")}
                    theme="dark"
                  />
                  <Button type="button" theme="outline" onClick={handleBrowse}>
                    {t("browse")}
                  </Button>
                </div>
              </div>

              {error && <p className="drive-selector__error">{error}</p>}

              <div className="drive-selector__actions">
                <Button
                  type="button"
                  theme="outline"
                  onClick={handleCancelSelector}
                >
                  {t("cancel")}
                </Button>
                <Button
                  type="button"
                  theme="danger"
                  onClick={handleStartTransfer}
                  disabled={!effectiveDest || isPreparing}
                >
                  {isPreparing ? "Preparing..." : t("start_transfer")}
                </Button>
              </div>
            </div>
          )}

          {/* Transfer progress */}
          {isTransferring && (
            <div className="transfer-progress">
              <div className="transfer-progress__header">
                <span className="transfer-progress__label">
                  {isPaused ? t("transfer_paused") : t("transferring_files")}
                </span>
                <span className="transfer-progress__pct">
                  {progressPercent}%
                </span>
              </div>

              <div className="transfer-progress__track">
                <div
                  className={[
                    "transfer-progress__fill",
                    isPaused && "transfer-progress__fill--paused",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="transfer-progress__footer">
                {gameSize > 0 && (
                  <span className="transfer-progress__size">
                    {fmt(transferredBytes)} / {fmt(gameSize)}
                  </span>
                )}
                <div className="transfer-progress__actions">
                  <Button
                    type="button"
                    theme="outline"
                    onClick={isPaused ? onResumeTransfer : onPauseTransfer}
                  >
                    {isPaused ? <Play size={14} /> : <Pause size={14} />}
                    {isPaused ? t("resume") : t("pause")}
                  </Button>
                  <Button
                    type="button"
                    theme="danger"
                    onClick={onCancelTransfer}
                  >
                    <X size={14} />
                    {t("cancel")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Shortcuts */}
      {game.executablePath && (
        <div className="game-options-modal__section">
          <div className="game-options-modal__header">
            <h2>{t("shortcuts_section_title")}</h2>
            <h4 className="game-options-modal__header-description">
              {t("shortcuts_section_description")}
            </h4>
          </div>
          <div className="game-options-modal__row">
            <Button onClick={() => onCreateShortcut("desktop")} theme="outline">
              {t("create_shortcut")}
            </Button>
            {game.shop !== "custom" &&
              (steamShortcutExists ? (
                <Button
                  onClick={onDeleteSteamShortcut}
                  theme="danger"
                  disabled={creatingSteamShortcut}
                >
                  <SteamLogo />
                  {t("delete_steam_shortcut")}
                </Button>
              ) : (
                <Button
                  onClick={onCreateSteamShortcut}
                  theme="outline"
                  disabled={creatingSteamShortcut}
                >
                  <SteamLogo />
                  {t("create_steam_shortcut")}
                </Button>
              ))}
            {shouldShowCreateStartMenuShortcut && (
              <Button
                onClick={() => onCreateShortcut("start_menu")}
                theme="outline"
              >
                {t("create_start_menu_shortcut")}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Launch options */}
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
                  code: <code className="game-options-modal__inline-code" />,
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
          onChange={onChangeLaunchOptions}
          rightContent={
            game.launchOptions && (
              <Button onClick={onClearLaunchOptions} theme="outline">
                {t("clear")}
              </Button>
            )
          }
        />
      </div>
    </>
  );
}
