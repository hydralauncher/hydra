import { StarIcon } from "@phosphor-icons/react";
import type { ProtonDBData } from "@types";
import type { FocusOverrides } from "../../../../services";
import { FocusItem, Typography } from "../../../common";
import ProtonDBLogo from "../../../../assets/protondb-logo.svg?url";

const protonTierLabels: Record<string, string> = {
  borked: "Borked",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
};

const deckCompatibilityLabels: Record<string, string> = {
  verified: "Verified",
  playable: "Playable",
  unsupported: "Unsupported",
  unknown: "Unknown",
};

export interface ProtonDBSectionProps {
  protonDBData: ProtonDBData | null;
  focusId?: string;
  focusNavigationOverrides?: FocusOverrides;
  focusNavigationOrder?: number;
}

export function ProtonDBSection({
  protonDBData,
  focusId,
  focusNavigationOverrides,
  focusNavigationOrder,
}: Readonly<ProtonDBSectionProps>) {
  if (!protonDBData) return null;

  const tier = protonDBData.tier?.toLowerCase().trim() ?? null;
  const tierLabel = tier ? (protonTierLabels[tier] ?? "-") : "-";

  const deckLabel = protonDBData.deckCompatibility
    ? (deckCompatibilityLabels[protonDBData.deckCompatibility] ?? "Unknown")
    : null;

  const scoreLabel =
    typeof protonDBData.score === "number"
      ? `${Math.round(protonDBData.score * 100)}%`
      : "-";

  return (
    <FocusItem
      id={focusId}
      navigationOverrides={focusNavigationOverrides}
      navigationOrder={focusNavigationOrder}
      asChild
    >
      <section
        className="game-page__sidebar-section game-page__protondb"
        aria-label="ProtonDB"
      >
        <div className="game-page__protondb-title">
          <Typography>ProtonDB</Typography>
        </div>

        <div className="game-page__protondb-row">
          <div className="game-page__protondb-meta">
            <img
              src={ProtonDBLogo}
              alt=""
              aria-hidden="true"
              className="game-page__protondb-logo"
            />
            <Typography className="game-page__protondb-label">
              Compatibility Tier
            </Typography>
          </div>

          <Typography className="game-page__protondb-value game-page__protondb-value--text">
            {tierLabel}
          </Typography>
        </div>

        <div className="game-page__protondb-row">
          <div className="game-page__protondb-meta">
            <svg
              viewBox="0 0 64 64"
              aria-hidden="true"
              className="game-page__protondb-logo"
              fill="none"
              shapeRendering="geometricPrecision"
            >
              <circle cx="22" cy="32" r="13" fill="#55A8E8" />
              <path
                d="M32 7C45.807 7 57 18.193 57 32C57 45.807 45.807 57 32 57V47C40.284 47 47 40.284 47 32C47 23.716 40.284 17 32 17V7Z"
                fill="#FFFFFF"
              />
            </svg>
            <Typography className="game-page__protondb-label">
              Steam Deck
            </Typography>
          </div>

          <Typography className="game-page__protondb-value game-page__protondb-value--text">
            {deckLabel ?? "Unknown"}
          </Typography>
        </div>

        <div className="game-page__protondb-row">
          <div className="game-page__protondb-meta">
            <StarIcon
              size={20}
              weight="fill"
              aria-hidden="true"
              className="game-page__protondb-icon"
            />
            <Typography className="game-page__protondb-label">Score</Typography>
          </div>

          <Typography className="game-page__protondb-value">
            {scoreLabel}
          </Typography>
        </div>
      </section>
    </FocusItem>
  );
}
