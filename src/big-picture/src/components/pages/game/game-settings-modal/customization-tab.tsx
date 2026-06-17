import type { ChangeEvent } from "react";
import type { LibraryGame } from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Input,
  Tabs,
  type TabsItem,
  VerticalFocusGroup,
} from "../../../common";
import { useGamepad } from "../../../../hooks";
import { SettingsSection } from "../../../../pages/settings/settings-section";
import { useNavigationIsFocused } from "../../../../stores";
import { GamepadButtonType } from "../../../../types";

import "./customization-tab.scss";

export const GAME_CUSTOMIZATION_SETTINGS_PRIMARY_CONTROL_ID =
  "game-customization-settings-primary-control";

type AssetTab = "icon" | "logo" | "hero";

export interface GameCustomizationSettingsProps {
  game: LibraryGame;
  gameTitle: string;
  updatingGameTitle: boolean;
  onChangeGameTitle: (event: ChangeEvent<HTMLInputElement>) => void;
  onBlurGameTitle: () => Promise<void>;
}

export function GameCustomizationSettingsTab({
  game: _game,
  gameTitle,
  updatingGameTitle,
  onChangeGameTitle,
  onBlurGameTitle,
}: Readonly<GameCustomizationSettingsProps>) {
  const { t } = useTranslation("big_picture");
  const [selectedAssetTab, setSelectedAssetTab] = useState<AssetTab>("icon");
  const [hasAssetTabsInteracted, setHasAssetTabsInteracted] = useState(false);
  const isFocused = useNavigationIsFocused(
    GAME_CUSTOMIZATION_SETTINGS_PRIMARY_CONTROL_ID
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

  useEffect(() => {
    const selectedIndex = assetTabValues.indexOf(selectedAssetTab);

    const removeLeftBumper = onButtonPressed(
      GamepadButtonType.LEFT_BUMPER,
      (event) => {
        if (!isFocused || !isActiveGamepadEvent(event) || selectedIndex === -1) {
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
        if (!isFocused || !isActiveGamepadEvent(event) || selectedIndex === -1) {
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
    isActiveGamepadEvent,
    isFocused,
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
        className="game-customization-settings-tab__section"
        title={t("edit_game_modal_assets")}
        description={t(
          "Choose which artwork you want to customize for this game."
        )}
      >
        <div className="game-customization-settings-tab__section-content">
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

          {selectedAssetTab === "icon" ? <p>Icon</p> : null}
          {selectedAssetTab === "logo" ? <p>Logo</p> : null}
          {selectedAssetTab === "hero" ? <p>Hero</p> : null}
        </div>
      </SettingsSection>
    </VerticalFocusGroup>
  );
}
