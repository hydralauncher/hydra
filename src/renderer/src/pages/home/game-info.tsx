import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  PlayIcon,
  DownloadIcon,
  ArrowRightIcon,
  PlusIcon,
  CheckIcon,
  FileDirectoryIcon,
} from "@primer/octicons-react";
import type { ShopAssets, ShopDetailsWithAssets } from "@types";
import { buildGameDetailsPath, getSteamLanguage } from "@renderer/helpers";
import { Button } from "@renderer/components";
import {
  useDownload,
  useLibrary,
  useDownloadSourceNames,
} from "@renderer/hooks";
import { motion, AnimatePresence } from "framer-motion";
import "./home.scss";

interface GameInfoProps {
  game: ShopAssets;
  isBgLight?: boolean;
  onInstallClick?: (game: ShopAssets) => void;
  onAddToLibrary?: (game: ShopAssets) => void;
  isInLibrary?: boolean;
  onLocateExecutable?: (game: ShopAssets) => void;
}

const detailsCache = new Map<string, ShopDetailsWithAssets>();

function formatDate(dateStr: string): string {
  const parts = dateStr.replace(/\./g, "").split(/[\s/]+/);
  if (parts.length < 3) return dateStr;

  const months: Record<string, string> = {
    jan: "Jan",
    feb: "Feb",
    mar: "Mar",
    apr: "Apr",
    may: "May",
    jun: "Jun",
    jul: "Jul",
    aug: "Aug",
    sep: "Sep",
    oct: "Oct",
    nov: "Nov",
    dec: "Dec",
    janeiro: "Jan",
    fevereiro: "Feb",
    março: "Mar",
    abril: "Apr",
    maio: "May",
    junho: "Jun",
    julho: "Jul",
    agosto: "Aug",
    setembro: "Sep",
    outubro: "Oct",
    novembro: "Nov",
    dezembro: "Dec",
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
    .replace(
      /\s*(co\.,?\s*ltd\.?|inc\.?|llc\.?|corp\.?|ltd\.?|gmbh|s\.?a\.?|s\.?r\.?l\.?|entertainment|interactive|studios?|games?|publishing)/gi,
      ""
    )
    .replace(/[,.\s]+$/, "")
    .trim();
}

export function GameInfo({
  game,
  isBgLight = false,
  onInstallClick,
  onAddToLibrary,
  isInLibrary = false,
  onLocateExecutable,
}: Readonly<GameInfoProps>) {
  const { i18n, t } = useTranslation("home");
  const navigate = useNavigate();
  const { lastPacket, progress } = useDownload();
  const isDownloading = lastPacket?.gameId === `${game.shop}:${game.objectId}`;
  const [details, setDetails] = useState<ShopDetailsWithAssets | null>(
    detailsCache.get(game.objectId) ?? null
  );
  const fetchedRef = useRef<string>("");
  const sourceNames = useDownloadSourceNames(game);
  const [showAllTags, setShowAllTags] = useState(false);
  const [executableExists, setExecutableExists] = useState<boolean | null>(
    null
  );
  const { library } = useLibrary();
  const libraryGame = library.find(
    (g) => g.objectId === game.objectId && g.shop === game.shop
  );
  const executablePath = ((game as any).executablePath ??
    libraryGame?.executablePath) as string | null | undefined;

  useEffect(() => {
    const key = game.objectId;
    if (fetchedRef.current === key) return;
    fetchedRef.current = key;

    const cached = detailsCache.get(key);
    if (cached) {
      setDetails(cached);
      return;
    }

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
    setShowAllTags(false);
  }, [game.objectId]);

  useEffect(() => {
    setExecutableExists(null);
    if (!executablePath) return;
    if (typeof window.electron?.checkFileExists === "function") {
      window.electron.checkFileExists(executablePath).then(setExecutableExists);
    }
  }, [executablePath]);

  const publisher = details?.publishers?.[0]
    ? cleanPublisher(details.publishers[0])
    : "";
  const date = details?.release_date?.date
    ? formatDate(details.release_date.date)
    : "";

  const meta = [publisher, date].filter(Boolean).join(" - ");

  const visibleTags =
    showAllTags || sourceNames.length <= 3
      ? sourceNames
      : sourceNames.slice(0, 3);

  const detailsVariants = {
    initial: { opacity: 0 },
    animate: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05,
      },
    },
    exit: {
      opacity: 0,
      transition: { duration: 0.12 },
    },
  };

  const childVariants = {
    initial: { opacity: 0, y: 12, filter: "blur(4px)" },
    animate: {
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] as const },
    },
  };

  return (
    <div className="home__details">
      <AnimatePresence mode="wait">
        <motion.div
          key={game.objectId}
          variants={detailsVariants}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <motion.h1 variants={childVariants} className="home__game-title">
            {game.title}
          </motion.h1>

          {meta && (
            <motion.p variants={childVariants} className="home__game-meta">
              {meta}
            </motion.p>
          )}

          {sourceNames.length > 0 && (
            <motion.div variants={childVariants} className="home__source-tags">
              {visibleTags.map((name) => (
                <span
                  key={name}
                  className={`home__source-tag ${isBgLight ? "home__source-tag--dark" : ""}`}
                >
                  {name}
                </span>
              ))}

              {sourceNames.length > 3 && (
                <button
                  type="button"
                  className={`home__source-tag home__source-tag--toggle ${
                    isBgLight ? "home__source-tag--dark" : ""
                  }`}
                  onClick={() => setShowAllTags((prev) => !prev)}
                >
                  {showAllTags ? "-" : `+${sourceNames.length - 3}`}
                </button>
              )}
            </motion.div>
          )}

          <motion.div variants={childVariants} className="home__actions">
            {executablePath && executableExists === true ? (
              <Button
                className="home__play-button"
                theme={isBgLight ? "dark" : "primary"}
                onClick={() =>
                  window.electron.openGame(
                    game.shop,
                    game.objectId,
                    executablePath
                  )
                }
              >
                <PlayIcon size={16} />
                {t("play", { defaultValue: "Jogar" })}
              </Button>
            ) : (
              <>
                <Button
                  className="home__install-button"
                  theme={isBgLight ? "dark" : "primary"}
                  onClick={() => {
                    if (onInstallClick) {
                      onInstallClick(game);
                      return;
                    }
                    const path = buildGameDetailsPath({
                      ...game,
                      objectId: game.objectId,
                    });
                    navigate(path, { state: { openRepacks: true } });
                    try {
                      window.dispatchEvent(
                        new CustomEvent("hydra:openRepacks", {
                          detail: { objectId: game.objectId },
                        })
                      );
                    } catch (e) {
                      // Ignore
                    }
                  }}
                >
                  <DownloadIcon size={16} />
                  {isDownloading
                    ? t("downloading_progress", {
                        defaultValue: `Baixando - ${progress}`,
                        progress,
                      })
                    : t("install", { defaultValue: "Instalar" })}
                </Button>

                {executablePath &&
                  executableExists === false &&
                  onLocateExecutable && (
                    <Button
                      className="home__locate-button"
                      theme={isBgLight ? "dark" : "primary"}
                      title={t("locate_executable", {
                        defaultValue: "Localizar executável do jogo",
                      })}
                      onClick={() => onLocateExecutable(game)}
                    >
                      <FileDirectoryIcon size={16} />
                    </Button>
                  )}
              </>
            )}

            {onAddToLibrary && (
              <Button
                className="home__add-library-button"
                theme={isBgLight ? "dark" : "primary"}
                title={
                  isInLibrary
                    ? t("already_in_library", {
                        defaultValue: "Já está na biblioteca",
                      })
                    : t("add_to_library", {
                        defaultValue: "Adicionar à biblioteca",
                      })
                }
                onClick={() => !isInLibrary && onAddToLibrary(game)}
                disabled={isInLibrary}
              >
                {isInLibrary ? <CheckIcon size={16} /> : <PlusIcon size={16} />}
              </Button>
            )}

            <Button
              className="home__view-game-button"
              theme={isBgLight ? "dark" : "primary"}
              title={t("see_more", { defaultValue: "Ver página" })}
              onClick={() => navigate(buildGameDetailsPath(game))}
            >
              <ArrowRightIcon size={16} />
            </Button>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
