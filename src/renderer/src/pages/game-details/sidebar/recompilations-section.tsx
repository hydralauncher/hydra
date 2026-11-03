import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronRightIcon } from "@primer/octicons-react";
import type { RecompilationSummary } from "@types";
import { formatBytes } from "@shared";

import { Button } from "@renderer/components/button/button";
import { TestedMedal } from "@renderer/components/tested-medal/tested-medal";
import { useToast } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import {
  buildRecompilationPath,
  getGameRecompilations,
} from "../../recompilation/recompilations-api";
import { useRecompilationInstall } from "../../recompilation/use-recompilation-install";
import { useRecompilationRom } from "../../recompilation/use-recompilation-rom";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import "./recompilations-section.scss";

interface RecompilationRowProps {
  objectId: string;
  recompilation: RecompilationSummary;
}

function RecompilationRow({
  objectId,
  recompilation,
}: Readonly<RecompilationRowProps>) {
  const { t } = useTranslation("recompilation");
  const navigate = useNavigate();
  const { state, progress, isRunning, play, close } = useRecompilationInstall(
    objectId,
    recompilation.slug
  );

  const { showErrorToast } = useToast();
  const rom = useRecompilationRom(objectId, recompilation.slug);
  const isMissingRom =
    rom.state !== null &&
    (rom.state.handlesRom
      ? !rom.state.romPath && !rom.state.isReady
      : !rom.state.libraryRomPath && rom.downloadPhase === null);

  const runPlay = async () => {
    if (!(await play())) showErrorToast(t("play_failed"));
  };

  const isDownloading = progress?.phase === "downloading";
  const isExtracting = progress?.phase === "extracting";
  const hasUpdate =
    state?.installed === true && state.version !== recompilation.version;

  const openPage = () =>
    navigate(buildRecompilationPath(objectId, recompilation.slug));
  const openRomStep = () =>
    navigate(
      rom.state?.handlesRom
        ? `${buildRecompilationPath(objectId, recompilation.slug)}?rom=1`
        : buildRecompilationPath(objectId, recompilation.slug)
    );

  let action: { label: string; onClick: () => void } = {
    label: t("play"),
    onClick: () => void runPlay(),
  };
  if (isRunning) {
    action = { label: t("close"), onClick: () => void close() };
  } else if (hasUpdate) {
    action = { label: t("update"), onClick: openPage };
  } else if (isMissingRom) {
    action = {
      label: rom.state?.handlesRom ? t("choose_rom") : t("download_rom"),
      onClick: openRomStep,
    };
  }

  let subtitle = `${t(`tested_level_short_${recompilation.tested.level}`)} · ${recompilation.author}`;
  if (isDownloading) {
    subtitle =
      progress.total && progress.loaded !== undefined
        ? t("row_downloading_size", {
            loaded: formatBytes(progress.loaded),
            total: formatBytes(progress.total),
          })
        : t("row_downloading");
  } else if (isExtracting) {
    subtitle = t("row_extracting");
  } else if (hasUpdate) {
    subtitle = t("row_update_available", { version: state.version });
  } else if (state?.installed) {
    subtitle = t("row_installed", { version: state.version });
  }

  const percent =
    isDownloading && progress.total && progress.loaded !== undefined
      ? Math.min(100, (progress.loaded / progress.total) * 100)
      : null;

  return (
    <div className="recompilations-section__row">
      <button
        type="button"
        className="recompilations-section__link"
        onClick={openPage}
      >
        {recompilation.iconUrl ? (
          <img
            className="recompilations-section__icon"
            src={recompilation.iconUrl}
            alt=""
          />
        ) : (
          <span className="recompilations-section__icon" />
        )}
        <span className="recompilations-section__text">
          <span className="recompilations-section__name">
            {recompilation.name}
          </span>
          <span className="recompilations-section__subtitle">
            {!isDownloading && !isExtracting && !state?.installed && (
              <TestedMedal level={recompilation.tested.level} />
            )}
            {subtitle}
          </span>
        </span>
        {!state?.installed && !isDownloading && !isExtracting && (
          <ChevronRightIcon className="recompilations-section__chevron" />
        )}
      </button>

      {state?.installed && !isDownloading && !isExtracting && (
        <Button
          theme={hasUpdate || isRunning ? "outline" : "primary"}
          className="recompilations-section__action"
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      )}

      {percent !== null && (
        <span
          className="recompilations-section__progress"
          style={{ width: `${percent}%` }}
        />
      )}
    </div>
  );
}

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
      <div className="recompilations-section">
        {recompilations.map((recompilation) => (
          <RecompilationRow
            key={recompilation.slug}
            objectId={objectId}
            recompilation={recompilation}
          />
        ))}
      </div>
    </SidebarSection>
  );
}
