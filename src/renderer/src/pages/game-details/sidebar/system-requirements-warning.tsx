import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  findRequirementMismatches,
  parseRequirementSizes,
  type RequirementMismatch,
  type SystemSpecs,
} from "@shared";
import "./system-requirements-warning.scss";

const GIB = 1024 ** 3;

const formatGigabytes = (bytes: number) =>
  `${Math.round((bytes / GIB) * 10) / 10} GB`;

export interface SystemRequirementsWarningProps {
  minimumRequirements: string | undefined;
}

/**
 * Warns when this PC has less RAM or free storage than the game's minimum
 * requirements list. Renders nothing when the requirements cannot be read or
 * the PC meets them.
 */
export function SystemRequirementsWarning({
  minimumRequirements,
}: SystemRequirementsWarningProps) {
  const { t } = useTranslation("game_details");
  const [specs, setSpecs] = useState<SystemSpecs | null>(null);

  useEffect(() => {
    let isCancelled = false;

    window.electron
      .getSystemSpecs()
      .then((result) => {
        if (!isCancelled) setSpecs(result);
      })
      .catch(() => {
        if (!isCancelled) setSpecs(null);
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const mismatches = useMemo<RequirementMismatch[]>(() => {
    if (!specs || !minimumRequirements) return [];

    return findRequirementMismatches(
      parseRequirementSizes(minimumRequirements),
      specs
    );
  }, [specs, minimumRequirements]);

  if (mismatches.length === 0) return null;

  return (
    <div className="system-requirements-warning" role="alert">
      <p className="system-requirements-warning__title">
        {t("system_requirements_warning_title")}
      </p>
      <ul className="system-requirements-warning__list">
        {mismatches.map((mismatch) => (
          <li key={mismatch.kind}>
            {mismatch.kind === "memory"
              ? t("system_requirements_memory_mismatch", {
                  required: formatGigabytes(mismatch.requiredBytes),
                  available: formatGigabytes(mismatch.availableBytes),
                })
              : t("system_requirements_storage_mismatch", {
                  required: formatGigabytes(mismatch.requiredBytes),
                  available: formatGigabytes(mismatch.availableBytes),
                })}
          </li>
        ))}
      </ul>
    </div>
  );
}
