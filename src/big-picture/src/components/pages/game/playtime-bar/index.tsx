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
      <div>
        <Typography>
          Played for <strong>{formatPlayTime(playTimeInSeconds)}</strong>
        </Typography>
        <Typography style={{ color: "rgba(255, 255, 255, 0.5)" }}>
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
