import type { ChangeEvent } from "react";
import type { LibraryGame, ShopAssets } from "@types";
import { PencilIcon } from "@primer/octicons-react";
import { Loader2, Trash } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FileExplorerModal,
  FocusItem,
  Input,
  Tabs,
  type TabsItem,
  type FileFilter,
  VerticalFocusGroup,
} from "../../../common";
import {
  resolveImageSource,
  resolvePreferredGameAssets,
} from "../../../../helpers";
import { SettingsSection } from "../../../../pages/settings/settings-section";
import { GameArtworkPicker } from "./artwork-picker";

import "./customization-tab.scss";

export const GAME_CUSTOMIZATION_SETTINGS_PRIMARY_CONTROL_ID =
  "game-customization-settings-primary-control";
const GAME_CUSTOMIZATION_SETTINGS_ASSET_PREVIEW_ID =
  "game-customization-settings-asset-preview";

type AssetTab = "icon" | "logo" | "hero" | "grid";
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
  grid: { width: 128, height: 192 },
};

export interface GameCustomizationSettingsProps {
  game: LibraryGame;
  gameTitle: string;
  updatingGameTitle: boolean;
  assetPickerFilters: FileFilter[];
  onChangeGameTitle: (event: ChangeEvent<HTMLInputElement>) => void;
  onBlurGameTitle: () => Promise<void>;
  onProcessAssetPath: (
    sourcePath: string,
    assetType: AssetTab
  ) => Promise<void>;
  onClearAsset: (assetType: AssetTab) => Promise<void>;
  onArtworkChanged: () => Promise<void> | void;
}

function getAssetPreviewState(
  game: LibraryGame,
  assets: ShopAssets | null
): AssetPreviewState {
  const preferredAssets = resolvePreferredGameAssets(game, assets);
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
      src: resolveImageSource(preferredAssets.libraryHeroImageUrl),
      hasCustom: isCustom
        ? Boolean(game.libraryHeroImageUrl)
        : Boolean(game.customHeroImageUrl),
    },
    grid: {
      src: resolveImageSource(preferredAssets.coverImageUrl),
      hasCustom: Boolean(game.customCoverImageUrl),
    },
  };
}

function getFallbackPreviewState(
  game: LibraryGame,
  assetType: AssetTab,
  assets: ShopAssets | null
): AssetPreviewState[AssetTab] {
  const isCustom = game.shop === "custom";

  if (assetType === "icon") {
    const nextGame = {
      ...game,
      [isCustom ? "iconUrl" : "customIconUrl"]: null,
    };

    return {
      src: resolvePreferredGameAssets(nextGame, assets).iconSrc,
      hasCustom: false,
    };
  }

  if (assetType === "logo") {
    const nextGame = {
      ...game,
      [isCustom ? "logoImageUrl" : "customLogoImageUrl"]: null,
    };

    return {
      src: resolvePreferredGameAssets(nextGame, assets).logoSrc,
      hasCustom: false,
    };
  }

  if (assetType === "grid") {
    const nextGame = { ...game, customCoverImageUrl: null };

    return {
      src: resolveImageSource(
        resolvePreferredGameAssets(nextGame, assets).coverImageUrl
      ),
      hasCustom: false,
    };
  }

  const nextGame = {
    ...game,
    [isCustom ? "libraryHeroImageUrl" : "customHeroImageUrl"]: null,
  };

  return {
    src: resolveImageSource(
      resolvePreferredGameAssets(nextGame, assets).libraryHeroImageUrl
    ),
    hasCustom: false,
  };
}

export function GameCustomizationSettingsTab({
  game,
  gameTitle,
  updatingGameTitle,
  assetPickerFilters,
  onChangeGameTitle,
  onBlurGameTitle,
  onProcessAssetPath,
  onClearAsset,
  onArtworkChanged,
}: Readonly<GameCustomizationSettingsProps>) {
  const { t } = useTranslation("big_picture");
  const [selectedAssetTab, setSelectedAssetTab] = useState<AssetTab>("icon");
  const [hasAssetTabsInteracted, setHasAssetTabsInteracted] = useState(false);
  const [composedAssets, setComposedAssets] = useState<ShopAssets | null>(null);
  const [assetPreviewState, setAssetPreviewState] = useState<AssetPreviewState>(
    () => getAssetPreviewState(game, null)
  );
  const [pendingAssetTab, setPendingAssetTab] = useState<AssetTab | null>(null);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const isCustomGame = game.shop === "custom";

  const refreshComposedAssets = useCallback(async () => {
    if (game.shop === "custom") return;

    const assets = await globalThis.window.electron.getGameAssets(
      game.objectId,
      game.shop
    );
    setComposedAssets(assets);
  }, [game.objectId, game.shop]);
  const assetTabItems = useMemo(() => {
    const items: Array<TabsItem<AssetTab>> = [
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
    ];

    if (!isCustomGame) {
      items.push({
        value: "grid",
        label: t("edit_game_modal_grid"),
      });
    }

    return items;
  }, [t, isCustomGame]);

  const handleAssetTabChange = useCallback((value: AssetTab) => {
    setSelectedAssetTab(value);
    setHasAssetTabsInteracted(true);
  }, []);
  const assetFrameSize = ASSET_FRAME_SIZES[selectedAssetTab];
  const hasCustomAsset = assetPreviewState[selectedAssetTab].hasCustom;
  const assetImageSource = assetPreviewState[selectedAssetTab].src;
  const [isPreviewImageLoaded, setIsPreviewImageLoaded] = useState(false);
  const previewImageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const image = previewImageRef.current;
    setIsPreviewImageLoaded(Boolean(image?.complete && image.naturalWidth > 0));
  }, [assetImageSource]);

  const handleAssetPicked = useCallback(
    (path: string) => {
      setAssetPickerOpen(false);
      setPendingAssetTab(selectedAssetTab);

      void onProcessAssetPath(path, selectedAssetTab).finally(() => {
        setPendingAssetTab(null);
      });
    },
    [onProcessAssetPath, selectedAssetTab]
  );

  const handleAssetPickerClose = useCallback(() => {
    setAssetPickerOpen(false);
    setPendingAssetTab(null);
  }, []);

  const handleAssetPreviewAction = useCallback(() => {
    if (pendingAssetTab) return;

    if (hasCustomAsset) {
      setPendingAssetTab(selectedAssetTab);
      setAssetPreviewState((currentState) => ({
        ...currentState,
        [selectedAssetTab]: getFallbackPreviewState(
          game,
          selectedAssetTab,
          composedAssets
        ),
      }));

      void onClearAsset(selectedAssetTab).finally(() => {
        setPendingAssetTab((currentTab) =>
          currentTab === selectedAssetTab ? null : currentTab
        );
      });
      return;
    }

    setAssetPickerOpen(true);
  }, [
    composedAssets,
    game,
    hasCustomAsset,
    onClearAsset,
    pendingAssetTab,
    selectedAssetTab,
  ]);

  useEffect(() => {
    if (game.shop === "custom") {
      setComposedAssets(null);
      return;
    }

    let cancelled = false;

    globalThis.window.electron
      .getGameAssets(game.objectId, game.shop)
      .then((assets) => {
        if (!cancelled) setComposedAssets(assets);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [game.objectId, game.shop]);

  useEffect(() => {
    setAssetPreviewState(getAssetPreviewState(game, composedAssets));
  }, [game, composedAssets]);

  useEffect(() => {
    setPendingAssetTab(null);
  }, [game]);

  return (
    <>
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
          <div
            className={`game-customization-settings-tab__section-content game-customization-settings-tab__section-content--assets${
              isCustomGame
                ? ""
                : " game-customization-settings-tab__section-content--with-picker"
            }`}
          >
            <Tabs
              items={assetTabItems}
              value={selectedAssetTab}
              defaultValue="icon"
              onValueChange={handleAssetTabChange}
              itemsFocusable
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
                      ref={previewImageRef}
                      className={`game-customization-settings-tab__asset-preview-image${
                        isPreviewImageLoaded
                          ? " game-customization-settings-tab__asset-preview-image--loaded"
                          : ""
                      }`}
                      src={assetImageSource}
                      alt={gameTitle}
                      draggable={false}
                      onLoad={() => setIsPreviewImageLoaded(true)}
                      onError={() => setIsPreviewImageLoaded(true)}
                    />
                  ) : null}

                  {assetImageSource && !isPreviewImageLoaded ? (
                    <span
                      className="game-customization-settings-tab__asset-preview-spinner"
                      aria-hidden="true"
                    >
                      <Loader2 size={28} />
                    </span>
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

            {!isCustomGame ? (
              <GameArtworkPicker
                key={`${game.shop}:${game.objectId}:${selectedAssetTab}`}
                game={game}
                assetType={selectedAssetTab}
                onChanged={async () => {
                  await refreshComposedAssets();
                  await Promise.resolve(onArtworkChanged()).catch(() => {});
                }}
              />
            ) : null}
          </div>
        </SettingsSection>
      </VerticalFocusGroup>

      <FileExplorerModal
        visible={assetPickerOpen}
        onClose={handleAssetPickerClose}
        onSelect={handleAssetPicked}
        title={t("edit_game_modal_assets")}
        filters={assetPickerFilters}
      />
    </>
  );
}
