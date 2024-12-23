import { Badge } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useRepacks } from "@renderer/hooks";
import { steamUrlBuilder } from "@shared";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import "./game-item.scss";

export interface GameItemProps {
  game: any;
}

export function GameItem({ game }: GameItemProps) {
  const navigate = useNavigate();

  const { getRepacksForObjectId } = useRepacks();

  const repacks = getRepacksForObjectId(game.objectId);

  const uniqueRepackers = useMemo(() => {
    return Array.from(new Set(repacks.map((repack) => repack.repacker)));
  }, [repacks]);

  return (
    <button
      type="button"
      className="game-item"
      onClick={() => navigate(buildGameDetailsPath(game))}
    >
      <img
        className="game-item__cover"
        src={steamUrlBuilder.library(game.objectId)}
        alt={game.title}
        loading="lazy"
      />

      <div className="game-item__details">
        <span>{game.title}</span>
        <span className="game-item__genres">{game.genres?.join(", ")}</span>

        <div className="game-item__repackers">
          {uniqueRepackers.map((repacker) => (
            <Badge key={repacker}>{repacker}</Badge>
          ))}
        </div>
      </div>
    </button>
  );
}
