import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { FileDirectoryIcon, XIcon } from "@primer/octicons-react";

import { Modal, TextField, Button } from "@renderer/components";
import {
  useLibrary,
  useSteamMatchSearch,
  useToast,
  type SteamMatchSuggestion,
} from "@renderer/hooks";
import {
  buildGameDetailsPath,
  generateRandomGradient,
} from "@renderer/helpers";
import { LINUX_GAME_EXECUTABLE_EXTENSIONS } from "@shared";
import { logger } from "@renderer/logger";
import type { ShopAssets } from "@types";

import "./sidebar-adding-custom-game-modal.scss";

export interface SidebarAddingCustomGameModalProps {
  visible: boolean;
  onClose: () => void;
}

export function SidebarAddingCustomGameModal({
  visible,
  onClose,
}: Readonly<SidebarAddingCustomGameModalProps>) {
  const { t } = useTranslation("sidebar");
  const { updateLibrary } = useLibrary();
  const { showSuccessToast, showErrorToast } = useToast();
  const navigate = useNavigate();

  const [gameName, setGameName] = useState("");
  const [executablePath, setExecutablePath] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [matchedGame, setMatchedGame] = useState<SteamMatchSuggestion | null>(
    null
  );
  const [matchedAssets, setMatchedAssets] = useState<ShopAssets | null>(null);

  const {
    suggestions: steamSuggestions,
    isSearching: isSearchingSteam,
    clearSuggestions,
  } = useSteamMatchSearch(gameName, !matchedGame);

  const handleSelectExecutable = async () => {
    const filters =
      window.electron.platform === "linux"
        ? [
            {
              name: t("custom_game_modal_executable"),
              extensions: LINUX_GAME_EXECUTABLE_EXTENSIONS,
            },
            { name: t("all_files", { ns: "game_details" }), extensions: ["*"] },
          ]
        : [
            {
              name: t("custom_game_modal_executable"),
              extensions: [
                "exe",
                "msi",
                "bat",
                "cmd",
                "app",
                "deb",
                "rpm",
                "dmg",
              ],
            },
          ];

    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters,
    });

    if (filePaths && filePaths.length > 0) {
      const selectedPath = filePaths[0];
      setExecutablePath(selectedPath);

      if (!gameName.trim()) {
        const fileName = selectedPath.split(/[\\/]/).pop() || "";
        const gameNameFromFile = fileName.replace(/\.[^/.]+$/, "");
        setGameName(gameNameFromFile);
      }
    }
  };

  const handleGameNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setGameName(event.target.value);

    if (matchedGame) {
      setMatchedGame(null);
      setMatchedAssets(null);
    }
  };

  const handleSelectMatch = (suggestion: SteamMatchSuggestion) => {
    setMatchedGame(suggestion);
    setGameName(suggestion.title);
    clearSuggestions();
    setMatchedAssets(null);

    window.electron
      .getGameAssets(suggestion.objectId, "steam")
      .then(setMatchedAssets)
      .catch((error) => {
        logger.error("Failed to fetch matched Steam game assets", error);
      });
  };

  const handleClearMatch = () => {
    setMatchedGame(null);
    setMatchedAssets(null);
  };

  const handleAddGame = async () => {
    if (!gameName.trim() || !executablePath.trim()) {
      showErrorToast(t("custom_game_modal_fill_required"));
      return;
    }

    setIsAdding(true);

    try {
      const gameNameForSeed = gameName.trim();
      // Use the matched Steam game's real artwork when available; otherwise
      // fall back to no icon/logo and a generated gradient hero.
      const iconUrl = matchedAssets?.iconUrl || "";
      const logoImageUrl = matchedAssets?.logoImageUrl || "";
      const libraryHeroImageUrl =
        matchedAssets?.libraryHeroImageUrl || generateRandomGradient();
      const customCoverImageUrl = matchedAssets?.coverImageUrl || null;

      const newGame = await window.electron.addCustomGameToLibrary(
        gameNameForSeed,
        executablePath,
        iconUrl,
        logoImageUrl,
        libraryHeroImageUrl,
        matchedGame?.objectId ?? null,
        customCoverImageUrl
      );

      showSuccessToast(t("custom_game_modal_success"));
      updateLibrary();

      const gameDetailsPath = buildGameDetailsPath({
        shop: "custom",
        objectId: newGame.objectId,
        title: newGame.title,
      });

      navigate(gameDetailsPath);

      setGameName("");
      setExecutablePath("");
      setMatchedGame(null);
      setMatchedAssets(null);
      onClose();
    } catch (error) {
      console.error("Failed to add custom game:", error);
      showErrorToast(
        error instanceof Error ? error.message : t("custom_game_modal_failed")
      );
    } finally {
      setIsAdding(false);
    }
  };

  const handleClose = () => {
    if (!isAdding) {
      setGameName("");
      setExecutablePath("");
      setMatchedGame(null);
      setMatchedAssets(null);
      onClose();
    }
  };

  const isFormValid = gameName.trim() && executablePath.trim();

  return (
    <Modal
      visible={visible}
      title={t("custom_game_modal")}
      description={t("custom_game_modal_description")}
      onClose={handleClose}
    >
      <div className="sidebar-adding-custom-game-modal__container">
        <div className="sidebar-adding-custom-game-modal__form">
          <TextField
            label={t("custom_game_modal_executable_path")}
            placeholder={t("custom_game_modal_select_executable")}
            value={executablePath}
            readOnly
            theme="dark"
            rightContent={
              <Button
                type="button"
                theme="outline"
                onClick={handleSelectExecutable}
                disabled={isAdding}
              >
                <FileDirectoryIcon />
                {t("custom_game_modal_browse")}
              </Button>
            }
          />

          <TextField
            label={t("custom_game_modal_title")}
            placeholder={t("custom_game_modal_enter_title")}
            value={gameName}
            onChange={handleGameNameChange}
            theme="dark"
            disabled={isAdding}
          />

          {matchedGame ? (
            <div className="sidebar-adding-custom-game-modal__match">
              {matchedGame.iconUrl && (
                <img
                  src={matchedGame.iconUrl}
                  alt=""
                  className="sidebar-adding-custom-game-modal__match-icon"
                />
              )}
              <span className="sidebar-adding-custom-game-modal__match-label">
                {t("custom_game_modal_match_selected", {
                  title: matchedGame.title,
                })}
              </span>
              <button
                type="button"
                className="sidebar-adding-custom-game-modal__match-clear"
                onClick={handleClearMatch}
                disabled={isAdding}
                aria-label={t("custom_game_modal_match_clear")}
              >
                <XIcon size={14} />
              </button>
            </div>
          ) : (
            (isSearchingSteam || steamSuggestions.length > 0) && (
              <div className="sidebar-adding-custom-game-modal__suggestions">
                <span className="sidebar-adding-custom-game-modal__suggestions-title">
                  {isSearchingSteam
                    ? t("custom_game_modal_match_searching")
                    : t("custom_game_modal_match_steam_title")}
                </span>
                <ul className="sidebar-adding-custom-game-modal__suggestions-list">
                  {steamSuggestions.map((suggestion) => (
                    <li key={suggestion.objectId}>
                      <button
                        type="button"
                        className="sidebar-adding-custom-game-modal__suggestion"
                        onClick={() => handleSelectMatch(suggestion)}
                        disabled={isAdding}
                      >
                        {suggestion.iconUrl && (
                          <img src={suggestion.iconUrl} alt="" />
                        )}
                        {suggestion.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}
        </div>

        <div className="sidebar-adding-custom-game-modal__actions">
          <Button
            type="button"
            theme="outline"
            onClick={handleClose}
            disabled={isAdding}
          >
            {t("custom_game_modal_cancel")}
          </Button>
          <Button
            type="button"
            theme="primary"
            onClick={handleAddGame}
            disabled={!isFormValid || isAdding}
          >
            {isAdding
              ? t("custom_game_modal_adding")
              : t("custom_game_modal_add")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
