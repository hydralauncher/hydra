import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLibrary, useDownload } from "@renderer/hooks";
import { BigPictureDownloadCard } from "./big-picture-download-card";
import "./big-picture-downloads.scss";

export default function BigPictureDownloads() {
  const { t } = useTranslation("big_picture");
  const { library } = useLibrary();
  const { lastPacket, progress, downloadSpeed, eta } = useDownload();

  const { active, queued, completed } = useMemo(() => {
    const active: typeof library = [];
    const queued: typeof library = [];
    const completed: typeof library = [];

    for (const game of library) {
      if (!game.download) continue;

      if (lastPacket?.gameId === game.id) {
        active.push(game);
      } else if (game.download.queued) {
        queued.push(game);
      } else if (game.download.status === "paused") {
        queued.push(game);
      } else if (game.executablePath) {
        completed.push(game);
      }
    }

    return { active, queued, completed };
  }, [library, lastPacket]);

  const hasDownloads = active.length + queued.length + completed.length > 0;

  if (!hasDownloads) {
    return (
      <div className="bp-downloads__empty">
        <h2>{t("no_downloads")}</h2>
      </div>
    );
  }

  return (
    <div className="bp-downloads">
      <h1>{t("downloads")}</h1>

      {active.length > 0 && (
        <section className="bp-downloads__section">
          <h3>{t("active_downloads")}</h3>
          {active.map((game) => (
            <BigPictureDownloadCard
              key={game.id}
              game={game}
              progress={lastPacket?.progress ?? 0}
              progressFormatted={progress}
              speed={downloadSpeed}
              eta={eta}
              status="active"
            />
          ))}
        </section>
      )}

      {queued.length > 0 && (
        <section className="bp-downloads__section">
          <h3>{t("queued")}</h3>
          {queued.map((game) => (
            <BigPictureDownloadCard
              key={game.id}
              game={game}
              progress={0}
              progressFormatted="0%"
              speed=""
              eta=""
              status={game.download?.status === "paused" ? "paused" : "queued"}
            />
          ))}
        </section>
      )}

      {completed.length > 0 && (
        <section className="bp-downloads__section">
          <h3>{t("completed")}</h3>
          {completed.map((game) => (
            <BigPictureDownloadCard
              key={game.id}
              game={game}
              progress={1}
              progressFormatted="100%"
              speed=""
              eta=""
              status="completed"
            />
          ))}
        </section>
      )}
    </div>
  );
}
