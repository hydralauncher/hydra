import { ShopDetails } from "@types";
import { parseRequirementRows } from "@shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FocusOverrides } from "../../../../services";
import { GamepadButtonType } from "../../../../types";
import { useGamepad } from "../../../../hooks";
import { useNavigationIsFocused } from "../../../../stores";
import { FocusItem, Typography } from "../../../common";

export interface RequirementsToPlayProps {
  shopDetails: ShopDetails;
  focusId?: string;
  focusNavigationOverrides?: FocusOverrides;
  focusNavigationOrder?: number;
}

export function RequirementsToPlay({
  shopDetails,
  focusId,
  focusNavigationOverrides,
  focusNavigationOrder,
}: Readonly<RequirementsToPlayProps>) {
  const [activeRequirement, setActiveRequirement] = useState<
    "minimum" | "recommended"
  >("minimum");
  const isFocused = useNavigationIsFocused(focusId ?? "");
  const { onButtonPressed, isActiveGamepadEvent } = useGamepad();
  const selectedTabIndex = activeRequirement === "minimum" ? 0 : 1;

  const selectRequirementByIndex = useCallback((index: number) => {
    setActiveRequirement(index <= 0 ? "minimum" : "recommended");
  }, []);

  const requirementRows = useMemo(() => {
    const raw =
      activeRequirement === "minimum"
        ? shopDetails.pc_requirements.minimum
        : shopDetails.pc_requirements.recommended;

    return parseRequirementRows(raw);
  }, [activeRequirement, shopDetails.pc_requirements]);

  useEffect(() => {
    const removeLeftBumper = onButtonPressed(
      GamepadButtonType.LEFT_BUMPER,
      (event) => {
        if (
          !isFocused ||
          !isActiveGamepadEvent(event) ||
          selectedTabIndex <= 0
        ) {
          return;
        }

        selectRequirementByIndex(selectedTabIndex - 1);
      }
    );

    const removeRightBumper = onButtonPressed(
      GamepadButtonType.RIGHT_BUMPER,
      (event) => {
        if (
          !isFocused ||
          !isActiveGamepadEvent(event) ||
          selectedTabIndex >= 1
        ) {
          return;
        }

        selectRequirementByIndex(selectedTabIndex + 1);
      }
    );

    return () => {
      removeLeftBumper();
      removeRightBumper();
    };
  }, [
    isActiveGamepadEvent,
    isFocused,
    onButtonPressed,
    selectRequirementByIndex,
    selectedTabIndex,
  ]);

  return (
    <FocusItem
      id={focusId}
      navigationOverrides={focusNavigationOverrides}
      navigationOrder={focusNavigationOrder}
      asChild
    >
      <section
        className="game-page__sidebar-section game-page__requirements-to-play"
        aria-label="System Requirements"
        data-empty={requirementRows.length === 0}
      >
        <div className="game-page__requirements-to-play-header">
          <div className="game-page__requirements-to-play-title">
            <Typography>System Requirements</Typography>
          </div>

          <div className="game-page__requirements-to-play-tabs">
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setActiveRequirement("minimum")}
              aria-pressed={activeRequirement === "minimum"}
              className="game-page__requirements-to-play-tab"
              data-active={activeRequirement === "minimum"}
            >
              Minimum
            </button>

            <button
              type="button"
              tabIndex={-1}
              onClick={() => setActiveRequirement("recommended")}
              aria-pressed={activeRequirement === "recommended"}
              className="game-page__requirements-to-play-tab"
              data-active={activeRequirement === "recommended"}
            >
              Recommended
            </button>
          </div>
        </div>

        {requirementRows.map((row, index) => (
          <div
            key={`${row.label ?? "info"}-${index}`}
            className="game-page__requirements-to-play-row"
            data-info={!row.label}
          >
            {row.label && (
              <Typography className="game-page__requirements-to-play-row-label">
                {row.label}
              </Typography>
            )}
            <Typography className="game-page__requirements-to-play-row-value">
              {row.value}
            </Typography>
          </div>
        ))}
      </section>
    </FocusItem>
  );
}
