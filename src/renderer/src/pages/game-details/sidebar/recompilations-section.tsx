import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRightIcon } from "@primer/octicons-react";
import type { RecompilationSummary } from "@types";

import { Link } from "@renderer/components/link/link";
import { TestedMedal } from "@renderer/components/tested-medal/tested-medal";
import { logger } from "@renderer/logger";
import {
  buildRecompilationPath,
  getGameRecompilations,
} from "../../recompilation/recompilations-api";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import "./recompilations-section.scss";

interface RecompilationsSectionProps {
  objectId: string;
}

export function RecompilationsSection({
  objectId,
}: Readonly<RecompilationsSectionProps>) {
  const { t } = useTranslation("recompilation");
  const [recompilations, setRecompilations] = useState<RecompilationSummary[]>(
    []
  );

  useEffect(() => {
    let cancelled = false;
    setRecompilations([]);

    getGameRecompilations(objectId)
      .then((items) => {
        if (!cancelled) setRecompilations(Array.isArray(items) ? items : []);
      })
      .catch((error) => {
        logger.error("Failed to load recompilations", error);
      });

    return () => {
      cancelled = true;
    };
  }, [objectId]);

  if (recompilations.length === 0) return null;

  return (
    <SidebarSection title={t("pc_versions")}>
      <ul className="list">
        {recompilations.map((recompilation) => (
          <li key={recompilation.slug}>
            <Link
              to={buildRecompilationPath(objectId, recompilation.slug)}
              className="list__item"
            >
              {recompilation.iconUrl ? (
                <img
                  className="list__item-image"
                  src={recompilation.iconUrl}
                  alt=""
                />
              ) : (
                <span className="list__item-image recompilations-section__no-icon" />
              )}
              <div className="recompilations-section__text">
                <p>{recompilation.name}</p>
                <small className="recompilations-section__meta">
                  <TestedMedal level={recompilation.tested.level} size={12} />
                  {t(`tested_level_short_${recompilation.tested.level}`)}
                  {" · "}
                  {recompilation.author}
                </small>
              </div>
              <ChevronRightIcon className="recompilations-section__chevron" />
            </Link>
          </li>
        ))}
      </ul>
    </SidebarSection>
  );
}
