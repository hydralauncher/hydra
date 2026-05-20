import { ShopDetails } from "@types";
import { useMemo, useState } from "react";
import { normalizeRequirementsHtml } from "../../../../helpers";
import { Typography } from "../../../common";

export interface RequirementsToPlayProps {
  shopDetails: ShopDetails;
}

interface RequirementRow {
  label: string;
  value: string;
}

const parseRequirementRows = (html: string): RequirementRow[] => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const items = Array.from(doc.querySelectorAll("li"));

  return items
    .map((item) => {
      const strong = item.querySelector("strong");
      const itemText = item.textContent?.replace(/\s+/g, " ").trim() ?? "";

      if (strong) {
        const label = strong.textContent?.replace(/:\s*$/, "").trim() ?? "";
        const value = itemText
          .replace(strong.textContent?.trim() ?? "", "")
          .replace(/^:\s*/, "")
          .trim();

        if (!label || !value) return null;

        return { label, value };
      }

      const colonIndex = itemText.indexOf(":");
      if (colonIndex <= 0) return null;

      const label = itemText.slice(0, colonIndex).trim();
      const value = itemText.slice(colonIndex + 1).trim();

      if (!label || !value) return null;

      return { label, value };
    })
    .filter((row): row is RequirementRow => Boolean(row));
};

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

  const requirementRows = useMemo(
    () => parseRequirementRows(normalizedHtml),
    [normalizedHtml]
  );

  return (
    <section
      className="game-page__requirements-to-play"
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
          key={`${row.label}-${index}`}
          className="game-page__requirements-to-play-row"
        >
          <Typography className="game-page__requirements-to-play-row-label">
            {row.label}
          </Typography>
          <Typography className="game-page__requirements-to-play-row-value">
            {row.value}
          </Typography>
        </div>
      ))}
    </section>
  );
}
