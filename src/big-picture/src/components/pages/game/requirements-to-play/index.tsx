import { ShopDetails } from "@types";
import { useMemo, useState } from "react";
import { FocusOverrides } from "src/big-picture/src/services/navigation.service";
import { normalizeRequirementsHtml } from "../../../../helpers";
import { Box, Button, HorizontalFocusGroup, Typography } from "../../../common";
import {
  GAME_ACHIEVEMENTS_VIEW_ALL_ID,
  GAME_REQUIREMENTS_TO_PLAY_BUTTONS_REGION_ID,
  GAME_REQUIREMENTS_TO_PLAY_MINIMUM_BUTTON_ID,
  GAME_REQUIREMENTS_TO_PLAY_RECOMMENDED_BUTTON_ID,
} from "../navigation";

export interface RequirementsToPlayProps {
  shopDetails: ShopDetails;
}

export function RequirementsToPlay({
  shopDetails,
}: Readonly<RequirementsToPlayProps>) {
  const [activeRequirement, setActiveRequirement] = useState<
    "minimum" | "recommended"
  >("minimum");

  const normalizedHtml = useMemo(() => {
    const raw =
      activeRequirement === "minimum"
        ? shopDetails.pc_requirements.minimum
        : shopDetails.pc_requirements.recommended;

    return normalizeRequirementsHtml(raw);
  }, [activeRequirement, shopDetails.pc_requirements]);

  const minimumButtonNavigationOverrides: FocusOverrides = {
    up: {
      type: "item",
      itemId: GAME_ACHIEVEMENTS_VIEW_ALL_ID,
    },
    left: {
      type: "block",
    },
    right: {
      type: "item",
      itemId: GAME_REQUIREMENTS_TO_PLAY_RECOMMENDED_BUTTON_ID,
    },
  };

  const recommendedButtonNavigationOverrides: FocusOverrides = {
    up: {
      type: "item",
      itemId: GAME_ACHIEVEMENTS_VIEW_ALL_ID,
    },
    left: {
      type: "item",
      itemId: GAME_REQUIREMENTS_TO_PLAY_MINIMUM_BUTTON_ID,
    },
    right: {
      type: "block",
    },
  };

  return (
    <div className="game-page__box-group">
      <div className="game-page__requirements-to-play-header">
        <div className="game-page__requirements-to-play-title">
          <Typography>System Requirements</Typography>
        </div>

        <HorizontalFocusGroup
          regionId={GAME_REQUIREMENTS_TO_PLAY_BUTTONS_REGION_ID}
        >
          <div className="game-page__requirements-to-play-buttons">
            <Button
              focusId={GAME_REQUIREMENTS_TO_PLAY_MINIMUM_BUTTON_ID}
              focusNavigationOverrides={minimumButtonNavigationOverrides}
              onClick={() => setActiveRequirement("minimum")}
              variant={activeRequirement === "minimum" ? "primary" : "rounded"}
            >
              Minimum
            </Button>

            <Button
              focusId={GAME_REQUIREMENTS_TO_PLAY_RECOMMENDED_BUTTON_ID}
              focusNavigationOverrides={recommendedButtonNavigationOverrides}
              onClick={() => setActiveRequirement("recommended")}
              variant={
                activeRequirement === "recommended" ? "primary" : "rounded"
              }
            >
              Recommended
            </Button>
          </div>
        </HorizontalFocusGroup>
      </div>

      <Box
        dangerouslySetInnerHTML={{ __html: normalizedHtml }}
        className="game-page__requirements-to-play-content"
      />
    </div>
  );
}
