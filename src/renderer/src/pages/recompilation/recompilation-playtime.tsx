import { useTranslation } from "react-i18next";
import type { LibraryGame } from "@types";
import { getDisplayedPlayTimeInMilliseconds } from "@shared";

import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { useFormat } from "@renderer/hooks";

interface RecompilationPlaytimeProps {
  game: LibraryGame | null;
  isRunning: boolean;
}

export function RecompilationPlaytime({
  game,
  isRunning,
}: Readonly<RecompilationPlaytimeProps>) {
  const { t } = useTranslation("game_details");
  const { numberFormatter } = useFormat();

  if (!game) return null;

  if (isRunning) {
    return <p className="recompilation-page__playtime">{t("playing_now")}</p>;
  }

  const milliseconds = getDisplayedPlayTimeInMilliseconds({
    playTimeInMilliseconds: game.playTimeInMilliseconds || 0,
    steamPlayTimeInMilliseconds: game.steamPlayTimeInMilliseconds,
    epicPlayTimeInMilliseconds: game.epicPlayTimeInMilliseconds,
  });

  if (!game.lastTimePlayed && milliseconds <= 0) {
    return (
      <p className="recompilation-page__playtime">
        {t("not_played_yet", { title: game.title })}
      </p>
    );
  }

  const minutes = milliseconds / 60_000;
  const amount =
    minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME
      ? t("amount_minutes", { amount: minutes.toFixed(0) })
      : t("amount_hours", { amount: numberFormatter.format(minutes / 60) });

  return (
    <p className="recompilation-page__playtime">{t("play_time", { amount })}</p>
  );
}
