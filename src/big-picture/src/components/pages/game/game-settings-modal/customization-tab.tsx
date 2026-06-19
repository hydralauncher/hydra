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
import { resolvePreferredGameAssets } from "../../../../helpers";
import { SettingsSection } from "../../../../pages/settings/settings-section";

import "./customization-tab.scss";

export const GAME_CUSTOMIZATION_SETTINGS_PRIMARY_CONTROL_ID =
  "game-customization-settings-primary-control";
const GAME_CUSTOMIZATION_SETTINGS_ASSET_PREVIEW_ID =
  "game-customization-settings-asset-preview";

type AssetTab = "icon" | "logo" | "hero";
type AssetPreviewState = Record<
  AssetTab,
  {
    src: string;
    hasCustom: boolean;
  }
>;

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

function getAssetPreviewState(game: LibraryGame): AssetPreviewState {
  const preferredAssets = resolvePreferredGameAssets(game, null);
  const isCustom = game.shop === "custom";

  return {
    icon: {
      src: preferredAssets.iconSrc,
      hasCustom: isCustom ? Boolean(game.iconUrl) : Boolean(game.customIconUrl),
    },
    logo: {
      src: preferredAssets.logoSrc,
      hasCustom: isCustom
        ? Boolean(game.logoImageUrl)
        : Boolean(game.customLogoImageUrl),
    },
    hero: {
      src: preferredAssets.heroSrc,
      hasCustom: isCustom
        ? Boolean(game.libraryHeroImageUrl)
        : Boolean(game.customHeroImageUrl),
    },
  };
}

function getFallbackPreviewState(
  game: LibraryGame,
  assetType: AssetTab
): AssetPreviewState[AssetTab] {
  const isCustom = game.shop === "custom";

  if (assetType === "icon") {
    const nextGame = {
      ...game,
      [isCustom ? "iconUrl" : "customIconUrl"]: null,
    };

    return {
      src: resolvePreferredGameAssets(nextGame, null).iconSrc,
      hasCustom: false,
    };
  }

  if (assetType === "logo") {
    const nextGame = {
      ...game,
      [isCustom ? "logoImageUrl" : "customLogoImageUrl"]: null,
    };

    return {
      src: resolvePreferredGameAssets(nextGame, null).logoSrc,
      hasCustom: false,
    };
  }

  const nextGame = {
    ...game,
    [isCustom ? "libraryHeroImageUrl" : "customHeroImageUrl"]: null,
  };

  return {
    src: resolvePreferredGameAssets(nextGame, null).heroSrc,
    hasCustom: false,
  };
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
  const [assetPreviewState, setAssetPreviewState] = useState<AssetPreviewState>(
    () => getAssetPreviewState(game)
  );
  const [pendingAssetTab, setPendingAssetTab] = useState<AssetTab | null>(null);
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

  const handleAssetTabChange = useCallback((value: AssetTab) => {
    setSelectedAssetTab(value);
    setHasAssetTabsInteracted(true);
  }, []);
  const assetFrameSize = ASSET_FRAME_SIZES[selectedAssetTab];
  const hasCustomAsset = assetPreviewState[selectedAssetTab].hasCustom;
  const assetImageSource = assetPreviewState[selectedAssetTab].src;
  const handleAssetPreviewAction = useCallback(() => {
    if (pendingAssetTab) return;

    if (hasCustomAsset) {
      setPendingAssetTab(selectedAssetTab);
      setAssetPreviewState((currentState) => ({
        ...currentState,
        [selectedAssetTab]: getFallbackPreviewState(game, selectedAssetTab),
      }));

      void onClearAsset(selectedAssetTab).finally(() => {
        setPendingAssetTab((currentTab) =>
          currentTab === selectedAssetTab ? null : currentTab
        );
      });
      return;
    }

    setPendingAssetTab(selectedAssetTab);
    void onSelectAsset(selectedAssetTab).finally(() => {
      setPendingAssetTab((currentTab) =>
        currentTab === selectedAssetTab ? null : currentTab
      );
    });
  }, [
    game,
    hasCustomAsset,
    onClearAsset,
    onSelectAsset,
    pendingAssetTab,
    selectedAssetTab,
  ]);

  useEffect(() => {
    setAssetPreviewState(getAssetPreviewState(game));
    setPendingAssetTab(null);
  }, [game]);

  return (
    <VerticalFocusGroup className="game-customization-settings-tab">
      <SettingsSection
        className="game-customization-settings-tab__section"
        title={t("edit_game_modal_section_title")}
        description={t("edit_game_modal_section_title_description")}
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
        description={t("edit_game_modal_section_assets_description")}
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
                    ? t("edit_game_modal_remove_asset")
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
