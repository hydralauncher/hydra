import { useTranslation } from "react-i18next";
import type { ShopAssets } from "@types";
import type { HomeGroup } from "@renderer/hooks/use-home-groups";
import { useNavigate } from "react-router-dom";
import { buildGameDetailsPath } from "@renderer/helpers";
import { ArrowRightIcon } from "@primer/octicons-react";
import { motion, AnimatePresence } from "framer-motion";
import cn from "classnames";
import "./home.scss";

interface FolderInfoProps {
  folder: HomeGroup;
  libraryAsGames: (ShopAssets & { executablePath?: string | null })[];
  onOpenFolder: () => void;
  isBgLight?: boolean;
  className?: string;
}

export function FolderInfo({
  folder,
  libraryAsGames,
  onOpenFolder,
  isBgLight: _isBgLight = false,
  className,
}: Readonly<FolderInfoProps>) {
  const { t } = useTranslation("home");
  const navigate = useNavigate();

  const games = folder.gameIds
    .map((id) => libraryAsGames.find((lg) => lg.objectId === id))
    .filter(Boolean) as (ShopAssets & { executablePath?: string | null })[];

  const first5 = games.slice(0, 5);

  return (
    <div className={cn("home__details home__folder-info-container", className)}>
      <AnimatePresence mode="wait">
        <motion.div
          key={folder.id}
          initial={{ opacity: 0, y: 14, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -10, filter: "blur(3px)" }}
          transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
          style={{ width: "100%" }}
        >
          <div className="home__folder-info-text">
            <h3 className="home__folder-info-title">{folder.name}</h3>
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
            <button
              type="button"
              className="home__folder-view-btn"
              onClick={onOpenFolder}
              aria-label={t("ver_pasta", { defaultValue: "Ver pasta" })}
            >
              <ArrowRightIcon size={24} />
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
