import { useAppSelector } from "@renderer/hooks";
import { useNavigate } from "react-router-dom";
import { buildGameDetailsPath } from "@renderer/helpers";
import { PlayIcon } from "@primer/octicons-react";
import { useEffect, useState } from "react";

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function SidebarGameRunning() {
  const navigate = useNavigate();
  const gameRunning = useAppSelector((s) => s.gameRunning.gameRunning);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!gameRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [gameRunning]);

  if (!gameRunning) return null;

  const elapsed = gameRunning.sessionDurationInMillis + tick * 1000;

  const handleClick = () => {
    navigate(
      buildGameDetailsPath({
        objectId: gameRunning.objectId,
        shop: gameRunning.shop,
        title: gameRunning.title,
      })
    );
  };

  return (
    <button
      type="button"
      className="sidebar-game-running"
      onClick={handleClick}
    >
      <div className="sidebar-game-running__pulse" />
      {gameRunning.iconUrl ? (
        <img
          src={gameRunning.iconUrl}
          alt={gameRunning.title}
          className="sidebar-game-running__icon"
        />
      ) : (
        <div className="sidebar-game-running__icon sidebar-game-running__icon--placeholder">
          <PlayIcon size={12} />
        </div>
      )}
      <div className="sidebar-game-running__info">
        <span className="sidebar-game-running__title">{gameRunning.title}</span>
        <span className="sidebar-game-running__time">
          {formatElapsed(elapsed)}
        </span>
      </div>
    </button>
  );
}
