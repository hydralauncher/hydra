import { useMemo } from "react";
import { useDownload, useLibrary } from "../../hooks";
import { DownloadSimpleIcon } from "@phosphor-icons/react";
import type { LibraryGame, SeedingStatus } from "@types";

export default function Downloads() {
  const { library } = useLibrary();
  const { lastPacket, seedingStatus } = useDownload();

  const downloadingGames = useMemo(() => {
    return library.filter((game) => {
      if (!game.download) return false;
      if (game.download.status === "removed") return false;

      // Currently downloading or extracting
      const isDownloading = lastPacket?.gameId === game.id;
      const isExtracting = game.download.extracting;

      return isDownloading || isExtracting;
    });
  }, [library, lastPacket]);

  const queuedGames = useMemo(() => {
    return library.filter((game) => {
      if (!game.download) return false;
      if (game.download.status === "removed") return false;

      // Queued, paused, or error
      const isQueued =
        game.download.queued &&
        game.download.status !== "complete" &&
        game.download.status !== "seeding";

      return (
        isQueued ||
        game.download.status === "paused" ||
        game.download.status === "error"
      );
    });
  }, [library]);

  const hasDownloads = downloadingGames.length > 0 || queuedGames.length > 0;

  if (!hasDownloads) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "white" }}>
        <DownloadSimpleIcon size={48} style={{ marginBottom: "1rem" }} />
        <h2>No Downloads</h2>
        <p>Start downloading games to see them here.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem", color: "white" }}>
      <h1 style={{ marginBottom: "2rem" }}>Downloads</h1>

      {downloadingGames.length > 0 && (
        <section style={{ marginBottom: "2rem" }}>
          <h2 style={{ marginBottom: "1rem" }}>Downloading</h2>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            {downloadingGames.map((game) => (
              <DownloadItem
                key={game.id}
                game={game}
                isDownloading={lastPacket?.gameId === game.id}
                progress={lastPacket?.progress || 0}
                downloadSpeed={lastPacket?.downloadSpeed || 0}
                seedingStatus={seedingStatus.find((s) => s.gameId === game.id)}
              />
            ))}
          </div>
        </section>
      )}

      {queuedGames.length > 0 && (
        <section>
          <h2 style={{ marginBottom: "1rem" }}>Queued</h2>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            {queuedGames.map((game) => (
              <DownloadItem
                key={game.id}
                game={game}
                isDownloading={false}
                progress={game.download?.progress || 0}
                downloadSpeed={0}
                seedingStatus={seedingStatus.find((s) => s.gameId === game.id)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

interface DownloadItemProps {
  game: LibraryGame;
  isDownloading: boolean;
  progress: number;
  downloadSpeed: number;
  seedingStatus?: SeedingStatus;
}

function DownloadItem({
  game,
  isDownloading,
  progress,
  downloadSpeed,
  seedingStatus,
}: DownloadItemProps) {
  const formatSpeed = (speed: number) => {
    if (speed === 0) return "0 B/s";
    const units = ["B/s", "KB/s", "MB/s", "GB/s"];
    let unitIndex = 0;
    while (speed >= 1024 && unitIndex < units.length - 1) {
      speed /= 1024;
      unitIndex++;
    }
    return `${speed.toFixed(1)} ${units[unitIndex]}`;
  };

  const getStatusText = () => {
    if (seedingStatus) {
      return `Seeding - ${formatSpeed(seedingStatus.uploadSpeed)}`;
    }
    if (isDownloading) {
      return `Downloading - ${formatSpeed(downloadSpeed)}`;
    }
    if (game.download?.status === "paused") {
      return "Paused";
    }
    if (game.download?.status === "error") {
      return "Error";
    }
    return "Queued";
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "1rem",
        backgroundColor: "#2a2a2a",
        borderRadius: "8px",
        gap: "1rem",
      }}
    >
      {game.iconUrl && (
        <img
          src={game.iconUrl}
          alt={game.title}
          style={{
            width: "64px",
            height: "64px",
            objectFit: "cover",
            borderRadius: "4px",
          }}
        />
      )}
      <div style={{ flex: 1 }}>
        <h3 style={{ margin: 0, marginBottom: "0.5rem" }}>{game.title}</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div
            style={{
              flex: 1,
              height: "8px",
              backgroundColor: "#444",
              borderRadius: "4px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progress * 100}%`,
                backgroundColor: isDownloading ? "#4CAF50" : "#666",
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <span style={{ fontSize: "0.9rem", color: "#ccc" }}>
            {(progress * 100).toFixed(1)}%
          </span>
        </div>
        <p
          style={{ margin: "0.5rem 0 0 0", fontSize: "0.9rem", color: "#aaa" }}
        >
          {getStatusText()}
        </p>
      </div>
    </div>
  );
}
