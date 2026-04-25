import { Trans, useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Button, TextField } from "@renderer/components";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import type { LibraryGame, ShortcutLocation } from "@types";
import { FileIcon } from "@primer/octicons-react";
import { HardDrive, X, FolderOpen } from "lucide-react";

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
  isTransferring: boolean;
  transferProgress: number;
  drives: DriveInfo[];
  onStartTransfer: (destPath: string) => Promise<void>;
  onCancelDriveSelection: () => void;
  transferSpeed?: number;
  transferETA?: number;
  showCancelConfirm?: boolean;
  onShowCancelConfirm?: () => void;
  onHideCancelConfirm?: () => void;
  onConfirmCancelTransfer?: () => void;
  showTitleSection?: boolean;
  showExecutableSection?: boolean;
  showTransferSection?: boolean;
  showShortcutsSection?: boolean;
  showLaunchOptionsSection?: boolean;
}

//
function formatETA(seconds: number) {
  if (seconds <= 0) return "";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return `${d}d ${h}h`;
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
  drives,
  onStartTransfer,
  onCancelDriveSelection,
  transferSpeed = 0,
  transferETA = 0,
  showCancelConfirm = false,
  onShowCancelConfirm = () => {},
  onHideCancelConfirm = () => {},
  onConfirmCancelTransfer = () => {},
  showTitleSection = true,
  showExecutableSection = true,
  showTransferSection = true,
  showShortcutsSection = true,
  showLaunchOptionsSection = true,
}: Readonly<GeneralSettingsSectionProps>) {
  const { t } = useTranslation("game_details");

  const [selectedDrive, setSelectedDrive] = useState<string | null>(null);
  const [customPath, setCustomPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);

  const gameSize = game.installedSizeInBytes ?? 0;
  const progressPercent = Math.round(transferProgress * 100);
  const transferredBytes = gameSize * transferProgress;
  const transferGameLabel = gameSize > 0 ? game.title : game.title;
  const transferGameSize = gameSize > 0 ? fmt(gameSize) : null;
  const pathSep = window.electron.platform === "win32" ? "\\" : "/";
  const gameRoot = game.executablePath
    ? game.executablePath.split(pathSep)[0] + pathSep
    : null;

  useEffect(() => {
    if (!isTransferring) return;
    console.log(
      "Transfer progress update:",
      `${Math.round(transferProgress * 100)}%`
    );
  }, [isTransferring, transferProgress]);

  const handleStartTransfer = async () => {
    let fullDest: string;
    const platform = window.electron.platform;
    const pathSeparator = platform === "win32" ? String.fromCharCode(92) : "/";

    if (selectedDrive !== null) {
      const normalizedDrive =
        selectedDrive.length > 1 && selectedDrive.endsWith(pathSeparator)
          ? selectedDrive.slice(0, -1)
          : selectedDrive;
      fullDest = `${normalizedDrive}${pathSeparator}Hydra Games`;
    } else if (customPath.trim()) {
      fullDest = customPath.trim();
    } else {
      setError(t("select_destination"));
      return;
    }

    setError(null);
    setIsPreparing(true);

    try {
      await onStartTransfer(fullDest);
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
    setSelectedDrive(null);
    setCustomPath("");
    setError(null);
    onCancelDriveSelection();
  };

  const effectiveDest = selectedDrive || customPath.trim();

  return (
    <>
      {/* Title */}
      {showTitleSection && (
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
      )}

      {/* Executable */}
      {showExecutableSection && (
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
                  <FolderOpen size={14} />
                  {t("open_folder")}
                </Button>
              )}
              {game.shop !== "custom" &&
                window.electron.platform === "win32" && (
                  <Button
                    type="button"
                    theme="outline"
                    onClick={onOpenSaveFolder}
                    disabled={loadingSaveFolder || !saveFolderPath}
                  >
                    <HardDrive size={14} />
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
      )}

      {/* Drive Selector */}
      {showTransferSection && game.executablePath && !isTransferring && (
        <div className="game-options-modal__section">
          <div className="game-options-modal__header">
            <h2>{t("transfer_game")}</h2>
            <h4 className="game-options-modal__header-description">
              {t("transfer_game_description", { game: transferGameLabel })}
              {transferGameSize && (
                <>
                  {" "}
                  (<span style={{ color: "#4ade80" }}>{transferGameSize}</span>)
                </>
              )}
            </h4>
          </div>

          <div className="drive-selector">
            {drives.length > 0 && (
              <div className="drive-selector__list">
                <div className="drive-selector__list-title">
                  {t("transfer_available_drives")}
                </div>
                {drives.map((drive) => {
                  const hasSufficientSpace = drive.free >= gameSize;
                  const hasInsufficientSpace = !hasSufficientSpace;
                  const isSelected =
                    selectedDrive === drive.root && !customPath;
                  const usedPct = Math.round(
                    ((drive.total - drive.free) / drive.total) * 100
                  );
                  const gamePct =
                    gameSize > 0
                      ? Math.min((gameSize / drive.total) * 100, 100 - usedPct)
                      : 0;

                  return (
                    <button
                      key={drive.root}
                      type="button"
                      className={`drive-card ${isSelected ? "drive-card--selected" : ""} ${hasInsufficientSpace ? "drive-card--nospace" : ""}`}
                      style={
                        gameRoot === drive.root
                          ? {
                              border: "1px solid #4ade80",
                              position: "relative",
                            }
                          : { position: "relative" }
                      }
                      onClick={() => {
                        if (hasInsufficientSpace) return;
                        setSelectedDrive(drive.root);
                        setCustomPath("");
                        setError(null);
                      }}
                      disabled={hasInsufficientSpace}
                    >
                      <HardDrive
                        size={18}
                        className="drive-card__icon"
                        color={gameRoot === drive.root ? "#4ade80" : undefined}
                      />
                      <div className="drive-card__body">
                        <div className="drive-card__top">
                          <span className="drive-card__label">
                            {drive.label || drive.root}
                          </span>
                          <span
                            className={`drive-card__space ${hasInsufficientSpace ? "drive-card__space--error" : ""}`}
                          >
                            {fmt(drive.free)} {t("transfer_free")}{" "}
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
                      {hasInsufficientSpace && (
                        <span className="drive-card__tag">
                          {t("transfer_insufficient_space")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="drive-selector__custom">
              <div className="drive-selector__path-row">
                <TextField
                  value={customPath}
                  onChange={(e) => {
                    setCustomPath(e.target.value);
                    setSelectedDrive(null);
                    setError(null);
                  }}
                  placeholder={t("transfer_destination_placeholder")}
                  theme="dark"
                />
                <Button type="button" theme="outline" onClick={handleBrowse}>
                  <FolderOpen size={14} />
                  {t("transfer_browse")}
                </Button>
              </div>
              {error && <p className="drive-selector__error">{error}</p>}
            </div>

            <div className="drive-selector__actions">
              <Button
                type="button"
                theme="outline"
                onClick={handleCancelSelector}
              >
                {t("clear")}
              </Button>
              <Button
                type="button"
                theme="danger"
                onClick={handleStartTransfer}
                disabled={!effectiveDest || isPreparing}
              >
                {isPreparing ? t("transfer_preparing") : t("start_transfer")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Progress */}
      {showTransferSection && isTransferring && (
        <div className="game-options-modal__section">
          <div className="game-options-modal__header">
            <h2>{t("transfer_game")}</h2>
          </div>

          <div className="transfer-progress">
            <div className="transfer-progress__header">
              <div className="transfer-progress__title">
                <span>{t("transfer_moving_files")}</span>
              </div>
              <span className="transfer-progress__pct">{progressPercent}%</span>
            </div>

            <div className="transfer-progress__track">
              <div
                className="transfer-progress__fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="transfer-progress__stats">
              <span className="transfer-progress__size">
                {fmt(transferredBytes)} / {fmt(gameSize)}
              </span>
              <span className="transfer-progress__speed">
                {transferSpeed > 0 ? (
                  <>
                    {transferSpeed.toFixed(1)} {t("transfer_speed_unit")}
                    {transferETA > 0 &&
                      ` • ${t("transfer_eta_label", { eta: formatETA(transferETA) })}`}
                  </>
                ) : (
                  t("transfer_calculating")
                )}
              </span>
            </div>

            <div className="transfer-progress__actions">
              <Button
                type="button"
                theme="danger"
                onClick={onShowCancelConfirm}
              >
                <X size={12} />
                {t("transfer_cancel_button")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {showTransferSection && showCancelConfirm && (
        <div className="cancel-confirm-overlay">
          <div className="cancel-confirm-modal">
            <h4>{t("transfer_cancel_title")}</h4>
            <p>{t("transfer_cancel_description")}</p>
            <div className="cancel-confirm-actions">
              <Button theme="outline" onClick={onHideCancelConfirm}>
                {t("transfer_continue")}
              </Button>
              <Button theme="danger" onClick={onConfirmCancelTransfer}>
                {t("transfer_cancel_confirm")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Shortcuts */}
      {showShortcutsSection && game.executablePath && (
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
      {showLaunchOptionsSection && (
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
      )}
    </>
  );
}
