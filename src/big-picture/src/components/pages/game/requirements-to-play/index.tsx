import { ShopDetails } from "@types";
import { useMemo, useState } from "react";
import { normalizeRequirementsHtml } from "../../../../helpers";
import { Box, Button, HorizontalFocusGroup, Typography } from "../../../common";

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

  return (
    <div className="game-page__box-group">
      <div className="game-page__requirements-to-play-header">
        <div className="game-page__requirements-to-play-title">
          <Typography>System Requirements</Typography>
        </div>

        <HorizontalFocusGroup regionId="requirements-to-play-buttons">
          <div className="game-page__requirements-to-play-buttons">
            <Button
              onClick={() => setActiveRequirement("minimum")}
              variant={activeRequirement === "minimum" ? "primary" : "rounded"}
            >
              Minimum
            </Button>

            <Button
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
