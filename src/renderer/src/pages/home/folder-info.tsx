import { useTranslation } from "react-i18next";
import type { ShopAssets } from "@types";
import { Button } from "@renderer/components";
import type { HomeGroup } from "@renderer/hooks/use-home-groups";
import { useNavigate } from "react-router-dom";
import { buildGameDetailsPath } from "@renderer/helpers";
import { ArrowRightIcon } from "@primer/octicons-react";
import "./home.scss";

interface FolderInfoProps {
  folder: HomeGroup;
  libraryAsGames: (ShopAssets & { executablePath?: string | null })[];
  onOpenFolder: () => void;
  isBgLight?: boolean;
}

export function FolderInfo({
  folder,
  libraryAsGames,
  onOpenFolder,
  isBgLight = false,
}: Readonly<FolderInfoProps>) {
  const { t } = useTranslation("home");
  const navigate = useNavigate();

  const games = folder.gameIds
    .map((id) => libraryAsGames.find((lg) => lg.objectId === id))
    .filter(Boolean) as (ShopAssets & { executablePath?: string | null })[];

  const first5 = games.slice(0, 5);

  return (
    <div className="home__details home__folder-info-container">
      <div className="home__folder-info-text">
        <h1 className="home__game-title">{folder.name}</h1>
        <p className="home__game-meta">
          {games.length}{" "}
          {games.length === 1
            ? t("game", { defaultValue: "jogo" })
            : t("games", { defaultValue: "jogos" })}
        </p>
      </div>

      <div className="home__folder-info-content">
        {first5.map((g) => (
          <button
            key={g.objectId}
            type="button"
            className="home__folder-game-card-btn"
            onClick={() => navigate(buildGameDetailsPath(g))}
          >
            <img
              src={
                g.shop === "steam"
                  ? `https://steamcdn-a.akamaihd.net/steam/apps/${g.objectId}/library_600x900_2x.jpg`
                  : (g.libraryImageUrl ?? undefined)
              }
              alt={g.title}
              className="home__folder-game-card"
              loading="lazy"
              onError={(e) => {
                const img = e.currentTarget;
                if (g.libraryImageUrl && img.src !== g.libraryImageUrl) {
                  img.src = g.libraryImageUrl;
                }
              }}
            />
          </button>
        ))}
        <Button
          className="home__folder-view-btn"
          theme={isBgLight ? "dark" : "primary"}
          onClick={onOpenFolder}
          aria-label={t("ver_pasta", { defaultValue: "Ver pasta" })}
        >
          <ArrowRightIcon size={24} />
        </Button>
      </div>
    </div>
  );
}
