import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, ChevronRightIcon, XIcon } from "@primer/octicons-react";
import cn from "classnames";
import type { RecompilationSummary } from "@types";

import { Link } from "@renderer/components/link/link";
import { TestedMedal } from "@renderer/components/tested-medal/tested-medal";
import { logger } from "@renderer/logger";
import {
  buildRecompilationPath,
  getGameRecompilations,
} from "../../recompilation/recompilations-api";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import { Button } from "@renderer/components/button/button";
import "./recompilations-section.scss";

const TIP_STORAGE_KEY = "hydra-recompilation-tip-dismissed";

// Games where the "runs native on PC" tip was closed or a recomp was installed.
const getTipDismissedGames = (): string[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(TIP_STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
};

const dismissTip = (objectId: string) => {
  const games = getTipDismissedGames();
  if (games.includes(objectId)) return;
  localStorage.setItem(TIP_STORAGE_KEY, JSON.stringify([...games, objectId]));
};

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
  const [showTip, setShowTip] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRecompilations([]);
    setShowTip(false);

    getGameRecompilations(objectId)
      .then(async (items) => {
        if (cancelled) return;
        const list = Array.isArray(items) ? items : [];
        setRecompilations(list);
        if (list.length === 0 || getTipDismissedGames().includes(objectId)) {
          return;
        }

        const states = await Promise.all(
          list.map(({ slug }) =>
            window.electron
              .getRecompilationInstallState({ objectId, slug })
              .catch(() => null)
          )
        );
        if (cancelled) return;
        if (states.some((state) => state?.installed)) {
          dismissTip(objectId);
          return;
        }
        setShowTip(true);
      })
      .catch((error) => {
        logger.error("Failed to load recompilations", error);
      });

    return () => {
      cancelled = true;
    };
  }, [objectId]);

  if (recompilations.length === 0) return null;

  const closeTip = () => {
    dismissTip(objectId);
    setShowTip(false);
  };

  return (
    <div
      className={cn("recompilations-section", {
        "recompilations-section--spotlight": showTip,
      })}
    >
      {showTip && (
        <>
          <span className="recompilations-section__beacon" aria-hidden="true" />
          <div
            className="recompilations-section__tip"
            role="dialog"
            aria-labelledby="recompilations-tip-title"
            aria-describedby="recompilations-tip-body"
          >
            <div className="recompilations-section__tip-header">
              <span className="recompilations-section__tip-chip">
                {t("tip_new")}
              </span>
              <button
                type="button"
                className="recompilations-section__tip-close"
                aria-label={t("tip_close")}
                onClick={closeTip}
              >
                <XIcon size={16} />
              </button>
            </div>

            <div className="recompilations-section__tip-copy">
              <h2 id="recompilations-tip-title">{t("tip_title")}</h2>
              <p id="recompilations-tip-body">{t("tip_body")}</p>
            </div>

            <div className="recompilations-section__tip-footer">
              <div className="recompilations-section__tip-perks">
                <span>
                  <CheckIcon size={12} />
                  {t("tip_no_emulator")}
                </span>
                <span>
                  <CheckIcon size={12} />
                  {t("tip_quick_install")}
                </span>
              </div>
              <Button theme="primary" onClick={closeTip}>
                {t("tip_got_it")}
              </Button>
            </div>
          </div>
        </>
      )}

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
    </div>
  );
}
