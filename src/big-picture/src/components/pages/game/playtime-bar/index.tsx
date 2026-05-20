import { Typography } from "../../../common";

import type { LibraryGame } from "@types";
import { useDate, useFormat } from "../../../../hooks";

export interface PlaytimeBarProps {
  game: LibraryGame | null;
}

export function PlaytimeBar({ game }: Readonly<PlaytimeBarProps>) {
  const { formatDistance } = useDate();
  const { formatPlayTime } = useFormat();

  const playTimeInSeconds = (game?.playTimeInMilliseconds ?? 0) / 1000;

  return (
    <div className="game-page__playtime-bar">
      <div className="game-page__playtime-bar-copy">
        <Typography className="game-page__playtime-bar-title">
          Played for{" "}
          <strong className="game-page__playtime-bar-value">
            {formatPlayTime(playTimeInSeconds)}
          </strong>
        </Typography>
        <Typography className="game-page__playtime-bar-subtitle">
          {game?.lastTimePlayed ? (
            <>
              Last played{" "}
              {formatDistance(game.lastTimePlayed, new Date(), {
                addSuffix: true,
              })}
            </>
          ) : (
            <>You haven&apos;t played {game?.title} yet</>
          )}
        </Typography>
      </div>
    </div>
  );
}
