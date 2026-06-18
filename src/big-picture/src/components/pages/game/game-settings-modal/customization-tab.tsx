import type { ChangeEvent } from "react";
import type { LibraryGame } from "@types";
import { PencilIcon } from "@primer/octicons-react";
import { Trash } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FocusItem,
  Input,
  Tabs,
  type TabsItem,
  VerticalFocusGroup,
} from "../../../common";
import {
  getGameHorizontalImageSource,
  resolveImageSource,
} from "../../../../helpers";
import { useGamepad } from "../../../../hooks";
import { SettingsSection } from "../../../../pages/settings/settings-section";
import { useNavigationIsFocused } from "../../../../stores";
import { GamepadButtonType } from "../../../../types";

import "./customization-tab.scss";

export const GAME_CUSTOMIZATION_SETTINGS_PRIMARY_CONTROL_ID =
  "game-customization-settings-primary-control";
const GAME_CUSTOMIZATION_SETTINGS_ASSET_PREVIEW_ID =
  "game-customization-settings-asset-preview";

type AssetTab = "icon" | "logo" | "hero";

const ASSET_FRAME_SIZES: Record<AssetTab, { width: number; height: number }> = {
  icon: { width: 192, height: 192 },
  logo: { width: 341.33, height: 192 },
  hero: { width: 594.58, height: 192 },
};

export interface GameCustomizationSettingsProps {
  game: LibraryGame;
  gameTitle: string;
  updatingGameTitle: boolean;
  onChangeGameTitle: (event: ChangeEvent<HTMLInputElement>) => void;
  onBlurGameTitle: () => Promise<void>;
  onSelectAsset: (assetType: AssetTab) => Promise<void>;
  onClearAsset: (assetType: AssetTab) => Promise<void>;
}

export function GameCustomizationSettingsTab({
  game,
  gameTitle,
  updatingGameTitle,
  onChangeGameTitle,
  onBlurGameTitle,
  onSelectAsset,
  onClearAsset,
}: Readonly<GameCustomizationSettingsProps>) {
  const { t } = useTranslation("big_picture");
  const [selectedAssetTab, setSelectedAssetTab] = useState<AssetTab>("icon");
  const [hasAssetTabsInteracted, setHasAssetTabsInteracted] = useState(false);
  const isPrimaryControlFocused = useNavigationIsFocused(
    GAME_CUSTOMIZATION_SETTINGS_PRIMARY_CONTROL_ID
  );
  const isAssetPreviewFocused = useNavigationIsFocused(
    GAME_CUSTOMIZATION_SETTINGS_ASSET_PREVIEW_ID
  );
  const { onButtonPressed, isActiveGamepadEvent } = useGamepad();
  const assetTabItems = useMemo(
    () =>
      [
        {
          value: "icon",
          label: t("edit_game_modal_icon"),
        },
        {
          value: "logo",
          label: t("edit_game_modal_logo"),
        },
        {
          value: "hero",
          label: t("edit_game_modal_hero"),
        },
      ] satisfies Array<TabsItem<AssetTab>>,
    [t]
  );
  const assetTabValues = useMemo(
    () => assetTabItems.map((item) => item.value),
    [assetTabItems]
  );

  const handleAssetTabChange = useCallback((value: AssetTab) => {
    setSelectedAssetTab(value);
    setHasAssetTabsInteracted(true);
  }, []);
  const assetFrameSize = ASSET_FRAME_SIZES[selectedAssetTab];
  const hasCustomAsset = useMemo(() => {
    switch (selectedAssetTab) {
      case "icon":
        return Boolean(game.customIconUrl);
      case "logo":
        return Boolean(game.customLogoImageUrl);
      case "hero":
        return Boolean(game.customHeroImageUrl);
      default:
        return false;
    }
  }, [
    game.customHeroImageUrl,
    game.customIconUrl,
    game.customLogoImageUrl,
    selectedAssetTab,
  ]);
  const assetImageSource = useMemo(() => {
    switch (selectedAssetTab) {
      case "icon":
        if (game.customIconUrl) {
          return resolveImageSource(game.customIconUrl);
        }
        return resolveImageSource(game.iconUrl);
      case "logo":
        if (game.customLogoImageUrl) {
          return resolveImageSource(game.customLogoImageUrl);
        }
        return resolveImageSource(game.logoImageUrl);
      case "hero":
        if (game.customHeroImageUrl) {
          return resolveImageSource(game.customHeroImageUrl);
        }
        return getGameHorizontalImageSource(game);
      default:
        return "";
    }
  }, [
    game.customIconUrl,
    game.customHeroImageUrl,
    game.customLogoImageUrl,
    game.iconUrl,
    game.libraryHeroImageUrl,
    game.libraryImageUrl,
    game.logoImageUrl,
    selectedAssetTab,
  ]);
  const handleAssetPreviewAction = useCallback(() => {
    if (hasCustomAsset) {
      void onClearAsset(selectedAssetTab);
      return;
    }

    void onSelectAsset(selectedAssetTab);
  }, [hasCustomAsset, onClearAsset, onSelectAsset, selectedAssetTab]);

  useEffect(() => {
    const selectedIndex = assetTabValues.indexOf(selectedAssetTab);

    const removeLeftBumper = onButtonPressed(
      GamepadButtonType.LEFT_BUMPER,
      (event) => {
        if (
          (!isPrimaryControlFocused && !isAssetPreviewFocused) ||
          !isActiveGamepadEvent(event) ||
          selectedIndex === -1
        ) {
          return;
        }

        const nextIndex =
          (selectedIndex - 1 + assetTabValues.length) % assetTabValues.length;

        handleAssetTabChange(assetTabValues[nextIndex] ?? "icon");
      }
    );

    const removeRightBumper = onButtonPressed(
      GamepadButtonType.RIGHT_BUMPER,
      (event) => {
        if (
          (!isPrimaryControlFocused && !isAssetPreviewFocused) ||
          !isActiveGamepadEvent(event) ||
          selectedIndex === -1
        ) {
          return;
        }

        const nextIndex = (selectedIndex + 1) % assetTabValues.length;

        handleAssetTabChange(assetTabValues[nextIndex] ?? "icon");
      }
    );

    return () => {
      removeLeftBumper();
      removeRightBumper();
    };
  }, [
    assetTabValues,
    handleAssetTabChange,
    isAssetPreviewFocused,
    isActiveGamepadEvent,
    isPrimaryControlFocused,
    onButtonPressed,
    selectedAssetTab,
  ]);

  return (
    <VerticalFocusGroup className="game-customization-settings-tab">
      <SettingsSection
        className="game-customization-settings-tab__section"
        title={t("Game Title")}
        description={t("Edit the title shown for this game in your library.")}
      >
        <div className="game-customization-settings-tab__section-content">
          <Input
            focusId={GAME_CUSTOMIZATION_SETTINGS_PRIMARY_CONTROL_ID}
            placeholder={t("edit_game_modal_enter_title")}
            value={gameTitle}
            disabled={updatingGameTitle}
            onChange={onChangeGameTitle}
            onBlur={() => {
              void onBlurGameTitle();
            }}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        className="game-customization-settings-tab__section game-customization-settings-tab__section--assets"
        title={t("edit_game_modal_assets")}
        description={t(
          "Choose which artwork you want to customize for this game."
        )}
      >
        <div className="game-customization-settings-tab__section-content game-customization-settings-tab__section-content--assets">
          <Tabs
            items={assetTabItems}
            value={selectedAssetTab}
            defaultValue="icon"
            onValueChange={handleAssetTabChange}
            itemsFocusable={false}
            animateSegmentedIndicator={hasAssetTabsInteracted}
            variant="segmented"
            ariaLabel={t("edit_game_modal_assets")}
            className="game-customization-settings-tab__asset-tabs"
          />

          <div className="game-customization-settings-tab__asset-preview">
            <FocusItem
              id={GAME_CUSTOMIZATION_SETTINGS_ASSET_PREVIEW_ID}
              asChild
              actions={{
                primary: handleAssetPreviewAction,
              }}
            >
              <button
                type="button"
                className="game-customization-settings-tab__asset-preview-frame"
                onClick={handleAssetPreviewAction}
                style={{
                  width: assetFrameSize.width,
                  height: assetFrameSize.height,
                }}
                aria-label={
                  hasCustomAsset
                    ? "Remove custom asset"
                    : t("edit_game_modal_assets")
                }
              >
                {assetImageSource ? (
                  <img
                    className="game-customization-settings-tab__asset-preview-image"
                    src={assetImageSource}
                    alt={gameTitle}
                    draggable={false}
                  />
                ) : null}

                <span
                  className={`game-customization-settings-tab__asset-preview-overlay${
                    hasCustomAsset
                      ? " game-customization-settings-tab__asset-preview-overlay--danger"
                      : ""
                  }`}
                  aria-hidden="true"
                >
                  <span
                    className={`game-customization-settings-tab__asset-preview-overlay-icon${
                      hasCustomAsset
                        ? " game-customization-settings-tab__asset-preview-overlay-icon--danger"
                        : ""
                    }`}
                  >
                    {hasCustomAsset ? (
                      <Trash size={20} />
                    ) : (
                      <PencilIcon size={22} />
                    )}
                  </span>
                </span>
              </button>
            </FocusItem>
          </div>
        </div>
      </SettingsSection>
    </VerticalFocusGroup>
  );
}
