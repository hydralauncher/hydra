import { Typography } from "../../../common";

import type { LibraryGame, LibraryGamePresentation } from "@types";
import { getDisplayedPlayTimeInMilliseconds } from "@shared";
import { useDate, useFormat } from "../../../../hooks";

export interface PlaytimeBarProps {
  game: LibraryGame | null;
  presentationGame?: LibraryGamePresentation | null;
  isGameRunning?: boolean;
  runningSessionDurationInMillis?: number | null;
}

function formatRunningSessionTime(
  sessionDurationInMillis: number | null | undefined,
  formatPlayTime: (playTimeInSeconds: number) => string
) {
  const sessionDurationInSeconds = (sessionDurationInMillis ?? 0) / 1000;

  if (sessionDurationInSeconds < 60) {
    return "less than a minute";
  }

  return formatPlayTime(sessionDurationInSeconds);
}

export function PlaytimeBar({
  game,
  presentationGame,
  isGameRunning = false,
  runningSessionDurationInMillis,
}: Readonly<PlaytimeBarProps>) {
  const { formatDistance } = useDate();
  const { formatPlayTime } = useFormat();

  const displayedGame = presentationGame ?? game;
  const playTimeInSeconds = displayedGame
    ? getDisplayedPlayTimeInMilliseconds(displayedGame) / 1000
    : 0;
  const runningSessionTimeLabel = formatRunningSessionTime(
    runningSessionDurationInMillis,
    formatPlayTime
  );

  return (
    <div className="game-page__playtime-bar">
      <div className="game-page__playtime-bar-copy">
        <Typography className="game-page__playtime-bar-title">
          {isGameRunning ? (
            "Playing now"
          ) : (
            <>
              Played for{" "}
              <strong className="game-page__playtime-bar-value">
                {formatPlayTime(playTimeInSeconds)}
              </strong>
            </>
          )}
        </Typography>
        <Typography className="game-page__playtime-bar-subtitle">
          {isGameRunning ? (
            <>
              Playing for{" "}
              <strong className="game-page__playtime-bar-value">
                {runningSessionTimeLabel}
              </strong>
            </>
          ) : displayedGame?.lastTimePlayed ? (
            <>
              Last played{" "}
              {formatDistance(displayedGame.lastTimePlayed, new Date(), {
                addSuffix: true,
              })}
            </>
          ) : playTimeInSeconds > 0 ? null : (
            <>You haven&apos;t played {displayedGame?.title} yet</>
          )}
        </Typography>
      </div>
    </div>
  );
}
