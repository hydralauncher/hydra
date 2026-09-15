import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpenIcon, TrashIcon } from "@phosphor-icons/react";
import type { LibraryGame, ProtonVersion } from "@types";
import {
  Button,
  Checkbox,
  DropdownSelect,
  FileExplorerModal,
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

const GAME_COMPATIBILITY_SETTINGS_GAMESCOPE_ID =
  "game-compatibility-settings-gamescope";

const GAME_COMPATIBILITY_SETTINGS_GAMESCOPE_RES_ID =
  "game-compatibility-settings-gamescope-res";

const GAME_COMPATIBILITY_SETTINGS_GAMESCOPE_OUT_RES_ID =
  "game-compatibility-settings-gamescope-out-res";

const GAME_COMPATIBILITY_SETTINGS_GAMESCOPE_UPSCALER_ID =
  "game-compatibility-settings-gamescope-upscaler";

const GAME_COMPATIBILITY_SETTINGS_GAMESCOPE_FPS_ID =
  "game-compatibility-settings-gamescope-fps";

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
  | "selectGameWinePrefix"
  | "selectGameProtonPath"
  | "toggleGameGamemode"
  | "toggleGameMangohud"
  | "toggleGameGamescope"
  | "updateGameGamescopeSettings"
  | "isGamescopeAvailable"
>;

export function GameCompatibilitySettingsTab({
  game,
}: Readonly<GameCompatibilitySettingsProps>) {
  const { t } = useTranslation(["game_details", "big_picture"]);
  const userPreferences = useUserPreferences();
  const electron = globalThis.window
    .electron as unknown as ElectronCompatibilityBridge;

  const [protonVersions, setProtonVersions] = useState<ProtonVersion[]>([]);
  const [gamemodeAvailable, setGamemodeAvailable] = useState(false);
  const [mangohudAvailable, setMangohudAvailable] = useState(false);
  const [gamescopeAvailable, setGamescopeAvailable] = useState(false);
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
  const [autoRunGamescope, setAutoRunGamescope] = useState(
    game.autoRunGamescope ?? false
  );
  const [winePickerOpen, setWinePickerOpen] = useState(false);
  const [winePickerInitialPath, setWinePickerInitialPath] = useState<
    string | undefined
  >();

  const [gamescopeResolution, setGamescopeResolution] = useState(
    game.gamescopeResolution ?? ""
  );
  const [gamescopeOutputResolution, setGamescopeOutputResolution] = useState(
    game.gamescopeOutputResolution ?? ""
  );
  const [gamescopeUpscaler, setGamescopeUpscaler] = useState(
    game.gamescopeUpscaler ?? ""
  );
  const [gamescopeFramerateLimit, setGamescopeFramerateLimit] = useState(
    game.gamescopeFramerateLimit?.toString() ?? ""
  );

  useEffect(() => {
    setSelectedProtonPath(game.protonPath ?? "");
    setWinePrefixPath(game.winePrefixPath ?? null);
    setAutoRunGamemode(game.autoRunGamemode ?? false);
    setAutoRunMangohud(game.autoRunMangohud ?? false);
    setAutoRunGamescope(game.autoRunGamescope ?? false);
    setGamescopeResolution(game.gamescopeResolution ?? "");
    setGamescopeOutputResolution(game.gamescopeOutputResolution ?? "");
    setGamescopeUpscaler(game.gamescopeUpscaler ?? "");
    setGamescopeFramerateLimit(game.gamescopeFramerateLimit?.toString() ?? "");
  }, [game]);

  useEffect(() => {
    const loadAvailability = async () => {
      const [
        protonVersionsResult,
        gamemodeResult,
        mangohudResult,
        gamescopeResult,
      ] = await Promise.all([
        electron.getInstalledProtonVersions(),
        electron.isGamemodeAvailable(),
        electron.isMangohudAvailable(),
        electron.isGamescopeAvailable(),
      ]);

      setProtonVersions(protonVersionsResult);
      setGamemodeAvailable(gamemodeResult);
      setMangohudAvailable(mangohudResult);
      setGamescopeAvailable(gamescopeResult);
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
    setWinePickerInitialPath(winePrefixPath ?? defaultPath ?? undefined);
    setWinePickerOpen(true);
  }, [electron, winePrefixPath]);

  const handleWinePrefixPicked = useCallback(
    async (path: string) => {
      setWinePickerOpen(false);
      await electron.selectGameWinePrefix(game.shop, game.objectId, path);
      setWinePrefixPath(path);
    },
    [electron, game.shop, game.objectId]
  );

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

  const handleToggleGamescope = useCallback(
    async (checked: boolean) => {
      setAutoRunGamescope(checked);
      await electron.toggleGameGamescope(game.shop, game.objectId, checked);
    },
    [electron, game.shop, game.objectId]
  );

  const handleUpdateGamescopeSetting = useCallback(
    async (
      key:
        | "gamescopeResolution"
        | "gamescopeOutputResolution"
        | "gamescopeUpscaler"
        | "gamescopeFramerateLimit",
      value: string
    ) => {
      if (key === "gamescopeResolution") setGamescopeResolution(value);
      if (key === "gamescopeOutputResolution")
        setGamescopeOutputResolution(value);
      if (key === "gamescopeUpscaler") setGamescopeUpscaler(value);
      if (key === "gamescopeFramerateLimit") setGamescopeFramerateLimit(value);

      let payloadGamescopeFramerateLimit: number | null = null;
      if (key === "gamescopeFramerateLimit") {
        payloadGamescopeFramerateLimit = value ? Number(value) : null;
      } else {
        payloadGamescopeFramerateLimit = gamescopeFramerateLimit
          ? Number(gamescopeFramerateLimit)
          : null;
      }

      const payload = {
        gamescopeResolution:
          key === "gamescopeResolution"
            ? value || null
            : gamescopeResolution || null,
        gamescopeOutputResolution:
          key === "gamescopeOutputResolution"
            ? value || null
            : gamescopeOutputResolution || null,
        gamescopeUpscaler:
          key === "gamescopeUpscaler"
            ? value || null
            : gamescopeUpscaler || null,
        gamescopeFramerateLimit: payloadGamescopeFramerateLimit,
      };

      await electron.updateGameGamescopeSettings(
        game.shop,
        game.objectId,
        payload
      );
    },
    [
      electron,
      game.shop,
      game.objectId,
      gamescopeResolution,
      gamescopeOutputResolution,
      gamescopeUpscaler,
      gamescopeFramerateLimit,
    ]
  );

  const globalAutoRunGamemode = userPreferences?.autoRunGamemode ?? false;
  const globalAutoRunMangohud = userPreferences?.autoRunMangohud ?? false;
  const globalAutoRunGamescope = userPreferences?.autoRunGamescope ?? false;

  const gamemodeDisabled = !gamemodeAvailable || globalAutoRunGamemode;
  const mangohudDisabled = !mangohudAvailable || globalAutoRunMangohud;
  const gamescopeDisabled = !gamescopeAvailable || globalAutoRunGamescope;

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

  let gamescopeSecondaryText: string | undefined;

  if (!gamescopeAvailable) {
    gamescopeSecondaryText = t("gamescope_not_available_tooltip");
  } else if (globalAutoRunGamescope) {
    gamescopeSecondaryText = t(
      "gamescope_disabled_due_to_global_setting_tooltip"
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
              icon={<FolderOpenIcon size={16} />}
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
                icon={<TrashIcon size={16} />}
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
        description={t("additional_options_description", { ns: "big_picture" })}
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

        <Checkbox
          id={GAME_COMPATIBILITY_SETTINGS_GAMESCOPE_ID}
          label="Gamescope"
          secondaryText={gamescopeSecondaryText}
          checked={autoRunGamescope || globalAutoRunGamescope}
          disabled={gamescopeDisabled}
          block
          onChange={(checked) => {
            handleToggleGamescope(checked).catch(() => {});
          }}
        />

        {(autoRunGamescope || globalAutoRunGamescope) && (
          <div className="game-compatibility-settings-tab__gamescope-settings">
            <HorizontalFocusGroup
              className="game-compatibility-settings-tab__gamescope-row"
              asChild
            >
              <div>
                <Input
                  focusId={GAME_COMPATIBILITY_SETTINGS_GAMESCOPE_RES_ID}
                  label={t("gamescope_resolution", {
                    defaultValue: "Game Resolution",
                  })}
                  value={gamescopeResolution}
                  onChange={(e) => {
                    handleUpdateGamescopeSetting(
                      "gamescopeResolution",
                      e.target.value
                    ).catch(() => {});
                  }}
                  placeholder="e.g. 1280x720"
                />
                <Input
                  focusId={GAME_COMPATIBILITY_SETTINGS_GAMESCOPE_OUT_RES_ID}
                  label={t("gamescope_output_resolution", {
                    defaultValue: "Output Resolution",
                  })}
                  value={gamescopeOutputResolution}
                  onChange={(e) => {
                    handleUpdateGamescopeSetting(
                      "gamescopeOutputResolution",
                      e.target.value
                    ).catch(() => {});
                  }}
                  placeholder="e.g. 1920x1080"
                />
              </div>
            </HorizontalFocusGroup>
            <HorizontalFocusGroup
              className="game-compatibility-settings-tab__gamescope-row"
              asChild
            >
              <div>
                <DropdownSelect
                  focusId={GAME_COMPATIBILITY_SETTINGS_GAMESCOPE_UPSCALER_ID}
                  label={t("gamescope_upscaler", {
                    defaultValue: "Upscaling Filter",
                  })}
                  value={gamescopeUpscaler}
                  onValueChange={(value) => {
                    handleUpdateGamescopeSetting(
                      "gamescopeUpscaler",
                      value
                    ).catch(() => {});
                  }}
                  options={[
                    { label: t("none", { defaultValue: "None" }), value: "" },
                    { label: "Linear", value: "linear" },
                    { label: "Nearest", value: "nearest" },
                    { label: "FSR", value: "fsr" },
                    { label: "NIS", value: "nis" },
                    { label: "Pixel", value: "pixel" },
                  ]}
                />
                <Input
                  focusId={GAME_COMPATIBILITY_SETTINGS_GAMESCOPE_FPS_ID}
                  label={t("gamescope_framerate_limit", {
                    defaultValue: "Framerate Limit",
                  })}
                  value={gamescopeFramerateLimit}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "");
                    handleUpdateGamescopeSetting(
                      "gamescopeFramerateLimit",
                      val
                    ).catch(() => {});
                  }}
                  placeholder="e.g. 60"
                />
              </div>
            </HorizontalFocusGroup>
          </div>
        )}
      </SettingsSection>

      <FileExplorerModal
        visible={winePickerOpen}
        onClose={() => setWinePickerOpen(false)}
        onSelect={(path) => {
          handleWinePrefixPicked(path).catch(() => {});
        }}
        title={t("wine_prefix")}
        initialPath={winePickerInitialPath}
        selectDirectory
      />
    </VerticalFocusGroup>
  );
}
