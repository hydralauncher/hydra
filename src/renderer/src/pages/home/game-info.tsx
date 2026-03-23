import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { PlusIcon, CheckIcon } from "@primer/octicons-react";
import type { DownloadSource, ShopAssets, ShopDetailsWithAssets } from "@types";
import { buildGameDetailsPath, getSteamLanguage } from "@renderer/helpers";
import { Button } from "@renderer/components";
import { useLibrary } from "@renderer/hooks/use-library";
import { levelDBService } from "@renderer/services/leveldb.service";
import { orderBy } from "lodash-es";
import "./home.scss";

interface GameInfoProps {
  game: ShopAssets;
  showAddButton?: boolean;
}

const detailsCache = new Map<string, ShopDetailsWithAssets>();
let sourcesCache: DownloadSource[] | null = null;

function formatDate(dateStr: string): string {
  const parts = dateStr.replace(/\./g, "").split(/[\s/]+/);
  if (parts.length < 3) return dateStr;

  const months: Record<string, string> = {
    jan: "Jan", feb: "Feb", mar: "Mar", apr: "Apr",
    may: "May", jun: "Jun", jul: "Jul", aug: "Aug",
    sep: "Sep", oct: "Oct", nov: "Nov", dec: "Dec",
    janeiro: "Jan", fevereiro: "Feb", março: "Mar",
    abril: "Apr", maio: "May", junho: "Jun",
    julho: "Jul", agosto: "Aug", setembro: "Sep",
    outubro: "Oct", novembro: "Nov", dezembro: "Dec",
  };

  const year = parts.find((p) => p.length === 4 && !isNaN(Number(p)));
  const monthPart = parts.find((p) =>
    Object.keys(months).some((m) => p.toLowerCase().startsWith(m))
  );

  if (!year) return dateStr;
  const monthKey = monthPart
    ? Object.keys(months).find((m) => monthPart.toLowerCase().startsWith(m))
    : undefined;
  const month = monthKey ? months[monthKey] : "";

  return month ? `${month}. ${year}` : year;
}

function cleanPublisher(raw: string): string {
  return raw
    .replace(/\s*(co\.,?\s*ltd\.?|inc\.?|llc\.?|corp\.?|ltd\.?|gmbh|s\.?a\.?|s\.?r\.?l\.?|entertainment|interactive|studios?|games?|publishing)/gi, "")
    .replace(/[,.\s]+$/, "")
    .trim();
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

export function GameInfo({ game, showAddButton = false }: Readonly<GameInfoProps>) {
  const { i18n, t } = useTranslation("home");
  const navigate = useNavigate();
  const { library, updateLibrary } = useLibrary();
  const isInLibrary = library.some(
    (g) => g.objectId === game.objectId && g.shop === game.shop
  );
  const [isAdding, setIsAdding] = useState(false);
  const [details, setDetails] = useState<ShopDetailsWithAssets | null>(
    detailsCache.get(game.objectId) ?? null
  );
  const fetchedRef = useRef<string>("");
  const [sourceNames, setSourceNames] = useState<string[]>([]);

  useEffect(() => {
    const key = game.objectId;
    if (fetchedRef.current === key) return;
    fetchedRef.current = key;

    const cached = detailsCache.get(key);
    if (cached) { setDetails(cached); return; }

    setDetails(null);
    window.electron
      .getGameShopDetails(key, game.shop, getSteamLanguage(i18n.language))
      .then((result) => {
        if (result) detailsCache.set(key, result);
        setDetails(result);
      })
      .catch(() => {});
  }, [game.objectId, game.shop, i18n.language]);

  useEffect(() => {
    const resolve = async () => {
      if (!sourcesCache) {
        const all = (await levelDBService.values("downloadSources")) as DownloadSource[];
        sourcesCache = orderBy(all, "createdAt", "desc");
      }

      const sources = game.downloadSources ?? [];

      if (!sources.length) {
        setSourceNames(sourcesCache.map((s) => s.name));
        return;
      }

      const areIds = sources.every((s) => UUID_RE.test(s));
      if (!areIds) {
        setSourceNames(sources);
        return;
      }

      const names = sources
        .map((id) => sourcesCache!.find((s) => s.id === id)?.name)
        .filter(Boolean) as string[];
      setSourceNames(names);
    };

    resolve();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.objectId, game.downloadSources?.join(",")]);

  const publisher = details?.publishers?.[0]
    ? cleanPublisher(details.publishers[0])
    : "";
  const date = details?.release_date?.date
    ? formatDate(details.release_date.date) : "";

  const meta = [publisher, date].filter(Boolean).join(" - ");

  return (
    <div className="home__details">
      <h1 className="home__game-title">{game.title}</h1>
      {meta && <p className="home__game-meta">{meta}</p>}
      {sourceNames.length > 0 && (
        <div className="home__source-tags">
          {sourceNames.map((name) => (
            <span key={name} className="home__source-tag">{name}</span>
          ))}
        </div>
      )}
      <div className="home__actions">
        <Button
          className="home__view-button"
          theme="primary"
          onClick={() => navigate(buildGameDetailsPath(game))}
        >
          {t("see_more")}
        </Button>
        {showAddButton && (
          <Button
            className="home__add-button"
            theme="outline"
            disabled={isInLibrary || isAdding}
            onClick={async () => {
              if (isInLibrary || isAdding) return;
              setIsAdding(true);
              try {
                await window.electron.addGameToLibrary(game.shop, game.objectId, game.title);
                updateLibrary();
              } finally {
                setIsAdding(false);
              }
            }}
          >
            {isInLibrary ? <CheckIcon size={16} /> : <PlusIcon size={16} />}
          </Button>
        )}
      </div>
    </div>
  );
}
