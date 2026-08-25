import { useContext } from "react";

import { useAppSelector, useDownload } from "@renderer/hooks";

import { HeroPanelPrimaryActions } from "./hero-panel-actions";

import { gameDetailsContext } from "@renderer/context";
import "./hero-panel.scss";

export function HeroPanel() {
  const { game } = useContext(gameDetailsContext);

  const { lastPacket } = useDownload();

  const extraction = useAppSelector((state) => state.download.extraction);

  const isGameDownloading =
    game?.download?.status === "active" && lastPacket?.gameId === game?.id;

  const isExtracting = extraction?.visibleId === game?.id;

  const showProgressBar =
    (game?.download?.status === "active" && game?.download?.progress < 1) ||
    game?.download?.status === "paused";

  const showExtractionProgressBar = isExtracting;

  return (
    <div className="hero-panel__container">
      <div className="hero-panel">
        <div className="hero-panel__actions">
          <HeroPanelPrimaryActions />
        </div>

        {showProgressBar && (
          <progress
            max={1}
            value={
              isGameDownloading
                ? lastPacket?.progress
                : game?.download?.progress
            }
            className={`hero-panel__progress-bar ${
              game?.download?.status === "paused"
                ? "hero-panel__progress-bar--disabled"
                : ""
            }`}
          />
        )}

        {showExtractionProgressBar && (
          <progress
            max={1}
            value={extraction?.progress ?? 0}
            className="hero-panel__progress-bar hero-panel__progress-bar--extraction"
          />
        )}
      </div>
    </div>
  );
}
