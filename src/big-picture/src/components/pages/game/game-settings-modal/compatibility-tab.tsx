import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Trash } from "@phosphor-icons/react";
import type { LibraryGame, ProtonVersion } from "@types";
import {
  Button,
  Checkbox,
  HorizontalFocusGroup,
  Input,
  Radio,
  VerticalFocusGroup,
} from "../../../common";
import { useUserPreferences } from "../../../../hooks/use-user-preferences.hook";
import { SettingsSection } from "../../../../pages/settings/settings-section";

import "./compatibility-tab.scss";

export const GAME_COMPATIBILITY_SETTINGS_PRIMARY_CONTROL_ID =
  "game-compatibility-settings-primary-control";

const GAME_COMPATIBILITY_SETTINGS_WINE_SELECT_ID =
  "game-compatibility-settings-wine-select";

const GAME_COMPATIBILITY_SETTINGS_WINE_CLEAR_ID =
  "game-compatibility-settings-wine-clear";

const GAME_COMPATIBILITY_SETTINGS_PROTON_AUTO_ID =
  "game-compatibility-settings-proton-auto";

function getProtonOptionFocusId(path: string) {
  return `game-compatibility-settings-proton-${path.replaceAll(/[^a-z0-9_-]/gi, "-").toLowerCase()}`;
}

const GAME_COMPATIBILITY_SETTINGS_GAMEMODE_ID =
  "game-compatibility-settings-gamemode";

const GAME_COMPATIBILITY_SETTINGS_MANGOHUD_ID =
  "game-compatibility-settings-mangohud";

interface GameCompatibilitySettingsProps {
  game: LibraryGame;
}

interface ProtonOption {
  focusId: string;
  value: string;
  title: string;
  description: string;
}

type ElectronCompatibilityBridge = Pick<
  Electron,
  | "getInstalledProtonVersions"
  | "isGamemodeAvailable"
  | "isMangohudAvailable"
  | "getDefaultWinePrefixSelectionPath"
  | "showOpenDialog"
  | "selectGameWinePrefix"
  | "selectGameProtonPath"
  | "toggleGameGamemode"
  | "toggleGameMangohud"
>;

export function GameCompatibilitySettingsTab({
  game,
}: Readonly<GameCompatibilitySettingsProps>) {
  const { t } = useTranslation("game_details");
  const userPreferences = useUserPreferences();
  const electron = globalThis.window
    .electron as unknown as ElectronCompatibilityBridge;

  const [protonVersions, setProtonVersions] = useState<ProtonVersion[]>([]);
  const [gamemodeAvailable, setGamemodeAvailable] = useState(false);
  const [mangohudAvailable, setMangohudAvailable] = useState(false);
  const [selectedProtonPath, setSelectedProtonPath] = useState(
    game.protonPath ?? ""
  );
  const [winePrefixPath, setWinePrefixPath] = useState<string | null>(
    game.winePrefixPath ?? null
  );
  const [autoRunGamemode, setAutoRunGamemode] = useState(
    game.autoRunGamemode ?? false
  );
  const [autoRunMangohud, setAutoRunMangohud] = useState(
    game.autoRunMangohud ?? false
  );

  useEffect(() => {
    setSelectedProtonPath(game.protonPath ?? "");
    setWinePrefixPath(game.winePrefixPath ?? null);
    setAutoRunGamemode(game.autoRunGamemode ?? false);
    setAutoRunMangohud(game.autoRunMangohud ?? false);
  }, [game]);

  useEffect(() => {
    const loadAvailability = async () => {
      const [protonVersionsResult, gamemodeResult, mangohudResult] =
        await Promise.all([
          electron.getInstalledProtonVersions(),
          electron.isGamemodeAvailable(),
          electron.isMangohudAvailable(),
        ]);

      setProtonVersions(protonVersionsResult);
      setGamemodeAvailable(gamemodeResult);
      setMangohudAvailable(mangohudResult);
    };

    void loadAvailability();
  }, [electron]);

  const getProtonSourceDescription = useCallback(
    (version: ProtonVersion | null) => {
      if (!version?.source) {
        return t("proton_source_umu_default");
      }

      if (version.source === "steam") {
        return t("proton_source_steam");
      }

      if (version.source === "compatibility_tools") {
        return t("proton_source_compatibility_tools");
      }

      return version.source;
    },
    [t]
  );

  const protonOptions = useMemo<ProtonOption[]>(() => {
    const options: ProtonOption[] = [
      {
        focusId: GAME_COMPATIBILITY_SETTINGS_PROTON_AUTO_ID,
        value: "",
        title: t("proton_version_auto"),
        description: getProtonSourceDescription(null),
      },
    ];

    for (const version of protonVersions) {
      options.push({
        focusId: getProtonOptionFocusId(version.path),
        value: version.path,
        title: version.name,
        description: getProtonSourceDescription(version),
      });
    }

    return options;
  }, [protonVersions, t, getProtonSourceDescription]);

  const handleSelectWinePrefix = useCallback(async () => {
    const defaultPath = await electron.getDefaultWinePrefixSelectionPath();

    const { filePaths } = await electron.showOpenDialog({
      properties: ["openDirectory"],
      defaultPath: winePrefixPath ?? defaultPath ?? "",
    });

    if (filePaths?.length) {
      await electron.selectGameWinePrefix(
        game.shop,
        game.objectId,
        filePaths[0]
      );
      setWinePrefixPath(filePaths[0]);
    }
  }, [electron, game.shop, game.objectId, winePrefixPath]);

  const handleClearWinePrefix = useCallback(async () => {
    await electron.selectGameWinePrefix(game.shop, game.objectId, null);
    setWinePrefixPath(null);
  }, [electron, game.shop, game.objectId]);

  const handleChangeProtonVersion = useCallback(
    async (value: string) => {
      setSelectedProtonPath(value);
      await electron.selectGameProtonPath(
        game.shop,
        game.objectId,
        value || null
      );
    },
    [electron, game.shop, game.objectId]
  );

  const handleToggleGamemode = useCallback(
    async (checked: boolean) => {
      setAutoRunGamemode(checked);
      await electron.toggleGameGamemode(game.shop, game.objectId, checked);
    },
    [electron, game.shop, game.objectId]
  );

  const handleToggleMangohud = useCallback(
    async (checked: boolean) => {
      setAutoRunMangohud(checked);
      await electron.toggleGameMangohud(game.shop, game.objectId, checked);
    },
    [electron, game.shop, game.objectId]
  );

  const globalAutoRunGamemode = userPreferences?.autoRunGamemode ?? false;
  const globalAutoRunMangohud = userPreferences?.autoRunMangohud ?? false;

  const gamemodeDisabled = !gamemodeAvailable || globalAutoRunGamemode;
  const mangohudDisabled = !mangohudAvailable || globalAutoRunMangohud;

  let gamemodeSecondaryText: string | undefined;

  if (!gamemodeAvailable) {
    gamemodeSecondaryText = t("gamemode_not_available_tooltip");
  } else if (globalAutoRunGamemode) {
    gamemodeSecondaryText = t(
      "gamemode_disabled_due_to_global_setting_tooltip"
    );
  }

  let mangohudSecondaryText: string | undefined;

  if (!mangohudAvailable) {
    mangohudSecondaryText = t("mangohud_not_available_tooltip");
  } else if (globalAutoRunMangohud) {
    mangohudSecondaryText = t(
      "mangohud_disabled_due_to_global_setting_tooltip"
    );
  }

  return (
    <VerticalFocusGroup className="game-compatibility-settings-tab">
      <SettingsSection
        className="game-compatibility-settings-tab__section"
        title={t("wine_prefix")}
        description={t("wine_prefix_description")}
      >
        <HorizontalFocusGroup
          className="game-compatibility-settings-tab__wine-prefix-row"
          asChild
        >
          <div>
            <Input
              focusId={GAME_COMPATIBILITY_SETTINGS_PRIMARY_CONTROL_ID}
              className="game-compatibility-settings-tab__wine-prefix-input"
              value={winePrefixPath ?? ""}
              placeholder={t("no_directory_selected")}
              readOnly
            />

            <Button
              focusId={GAME_COMPATIBILITY_SETTINGS_WINE_SELECT_ID}
              variant="secondary"
              icon={<FolderOpen size={16} />}
              onClick={() => {
                handleSelectWinePrefix().catch(() => {});
              }}
              focusNavigationOverrides={{
                left: {
                  type: "item",
                  itemId: GAME_COMPATIBILITY_SETTINGS_PRIMARY_CONTROL_ID,
                },
              }}
            >
              Select
            </Button>

            {winePrefixPath ? (
              <Button
                focusId={GAME_COMPATIBILITY_SETTINGS_WINE_CLEAR_ID}
                variant="danger"
                icon={<Trash size={16} />}
                onClick={() => {
                  handleClearWinePrefix().catch(() => {});
                }}
                focusNavigationOverrides={{
                  left: {
                    type: "item",
                    itemId: GAME_COMPATIBILITY_SETTINGS_PRIMARY_CONTROL_ID,
                  },
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </HorizontalFocusGroup>
      </SettingsSection>

      <SettingsSection
        className="game-compatibility-settings-tab__section"
        title={t("proton_version")}
        description={t("proton_version_description")}
      >
        <div className="game-compatibility-settings-tab__proton-options">
          {protonOptions.map((option) => (
            <Radio
              key={option.focusId}
              id={option.focusId}
              label={
                <span className="game-compatibility-settings-tab__proton-option-label">
                  <span className="game-compatibility-settings-tab__proton-option-title">
                    {option.title}
                  </span>
                  <span className="game-compatibility-settings-tab__proton-option-description">
                    {option.description}
                  </span>
                </span>
              }
              checked={selectedProtonPath === option.value}
              block
              onChange={() => {
                handleChangeProtonVersion(option.value).catch(() => {});
              }}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        className="game-compatibility-settings-tab__section"
        title={t("additional_options")}
        description="Configure per-game overrides for GameMode and MangoHud"
      >
        <Checkbox
          id={GAME_COMPATIBILITY_SETTINGS_GAMEMODE_ID}
          label="GameMode"
          secondaryText={gamemodeSecondaryText}
          checked={autoRunGamemode || globalAutoRunGamemode}
          disabled={gamemodeDisabled}
          block
          onChange={(checked) => {
            handleToggleGamemode(checked).catch(() => {});
          }}
        />

        <Checkbox
          id={GAME_COMPATIBILITY_SETTINGS_MANGOHUD_ID}
          label="MangoHud"
          secondaryText={mangohudSecondaryText}
          checked={autoRunMangohud || globalAutoRunMangohud}
          disabled={mangohudDisabled}
          block
          onChange={(checked) => {
            handleToggleMangohud(checked).catch(() => {});
          }}
        />
      </SettingsSection>
    </VerticalFocusGroup>
  );
}
