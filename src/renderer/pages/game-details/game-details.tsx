import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Color from "color";
import { average } from "color.js";

import type {
  Game,
  GameShop,
  HowLongToBeatCategory,
  ShopDetails,
  SteamAppDetails,
} from "@types";

import { AsyncImage, Button } from "@renderer/components";
import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch, useDownload } from "@renderer/hooks";
import { getSteamLanguage, steamUrlBuilder } from "@renderer/helpers";

import * as styles from "./game-details.css";
import { RepacksModal } from "./repacks-modal";
import { HeroPanel } from "./hero-panel";
import { useTranslation } from "react-i18next";
import { ShareAndroidIcon } from "@primer/octicons-react";
import { HowLongToBeatSection } from "./how-long-to-beat-section";

const OPEN_HYDRA_URL = "https://open.hydralauncher.site";

export function GameDetails() {
  const { objectID, shop } = useParams();

  const [color, setColor] = useState("");
  const [clipboardLock, setClipboardLock] = useState(false);
  const [gameDetails, setGameDetails] = useState<ShopDetails | null>(null);
  const [howLongToBeat, setHowLongToBeat] = useState<{
    isLoading: boolean;
    data: HowLongToBeatCategory[] | null;
  }>({ isLoading: true, data: null });

  const [game, setGame] = useState<Game | null>(null);
  const [activeRequirement, setActiveRequirement] =
    useState<keyof SteamAppDetails["pc_requirements"]>("minimum");

  const navigate = useNavigate();

  const { t, i18n } = useTranslation("game_details");

  const [showRepacksModal, setShowRepacksModal] = useState(false);

  const dispatch = useAppDispatch();

  const { game: gameDownloading, startDownload, isDownloading } = useDownload();

  const handleImageSettled = useCallback((url: string) => {
    average(url, { amount: 1, format: "hex" })
      .then((color) => {
        setColor(new Color(color).darken(0.6).toString() as string);
      })
      .catch(() => {});
  }, []);

  const getGame = useCallback(() => {
    window.electron
      .getGameByObjectID(objectID)
      .then((result) => setGame(result));
  }, [setGame, objectID]);

  useEffect(() => {
    getGame();
  }, [getGame, gameDownloading?.id]);

  useEffect(() => {
    dispatch(setHeaderTitle(""));

    window.electron
      .getGameShopDetails(objectID, "steam", getSteamLanguage(i18n.language))
      .then((result) => {
        if (!result) {
          navigate(-1);
          return;
        }

        window.electron
          .getHowLongToBeat(objectID, "steam", result.name)
          .then((data) => {
            setHowLongToBeat({ isLoading: false, data });
          });

        setGameDetails(result);
        dispatch(setHeaderTitle(result.name));
      });

    getGame();
    setHowLongToBeat({ isLoading: true, data: null });
    setClipboardLock(false);
  }, [getGame, dispatch, navigate, objectID, i18n.language]);

  const handleCopyToClipboard = () => {
    setClipboardLock(true);

    const searchParams = new URLSearchParams({
      p: btoa(
        JSON.stringify([
          objectID,
          shop,
          encodeURIComponent(gameDetails?.name),
          i18n.language,
        ])
      ),
    });

    navigator.clipboard.writeText(
      OPEN_HYDRA_URL + `/?${searchParams.toString()}`
    );

    const zero = performance.now();

    requestAnimationFrame(function holdLock(time) {
      if (time - zero <= 3000) {
        requestAnimationFrame(holdLock);
      } else {
        setClipboardLock(false);
      }
    });
  };

  const isGameDownloading = isDownloading && gameDownloading?.id === game?.id;

  useEffect(() => {
    if (isGameDownloading)
      setGame((prev) => ({ ...prev, status: gameDownloading?.status }));
  }, [isGameDownloading, gameDownloading?.status]);

  const handleStartDownload = async (repackId: number) => {
    return startDownload(
      repackId,
      gameDetails.objectID,
      gameDetails.name,
      shop as GameShop
    ).then(() => {
      getGame();
      setShowRepacksModal(false);
    });
  };

  return (
    <>
      {gameDetails && (
        <RepacksModal
          visible={showRepacksModal}
          gameDetails={gameDetails}
          startDownload={handleStartDownload}
          onClose={() => setShowRepacksModal(false)}
        />
      )}

      <section className={styles.container}>
        <div className={styles.hero}>
          <AsyncImage
            src={steamUrlBuilder.libraryHero(objectID)}
            className={styles.heroImage}
            alt={game?.title}
            onSettled={handleImageSettled}
          />
          <div className={styles.heroBackdrop}>
            <div className={styles.heroContent}>
              <AsyncImage
                src={steamUrlBuilder.logo(objectID)}
                style={{ width: 300, alignSelf: "flex-end" }}
              />
            </div>
          </div>
        </div>

        <HeroPanel
          game={game}
          color={color}
          gameDetails={gameDetails}
          openRepacksModal={() => setShowRepacksModal(true)}
          getGame={getGame}
        />

        <div className={styles.descriptionContainer}>
          <div className={styles.descriptionContent}>
            <div className={styles.descriptionHeader}>
              <section className={styles.descriptionHeaderInfo}>
                <p>
                  {t("release_date", {
                    date: gameDetails?.release_date.date,
                  })}
                </p>
                <p>
                  {t("publisher", { publisher: gameDetails?.publishers[0] })}
                </p>
              </section>

              <Button
                theme="outline"
                onClick={handleCopyToClipboard}
                disabled={clipboardLock || !gameDetails}
              >
                {clipboardLock ? (
                  t("copied_link_to_clipboard")
                ) : (
                  <>
                    <ShareAndroidIcon />
                    {t("copy_link_to_clipboard")}
                  </>
                )}
              </Button>
            </div>

            <div
              dangerouslySetInnerHTML={{
                __html: gameDetails?.about_the_game ?? "",
              }}
              className={styles.description}
            />
          </div>

          <div className={styles.contentSidebar}>
            <HowLongToBeatSection
              howLongToBeatData={howLongToBeat.data}
              isLoading={howLongToBeat.isLoading}
            />

            <div
              className={styles.contentSidebarTitle}
              style={{ border: "none" }}
            >
              <h3>{t("requirements")}</h3>
            </div>

            <div className={styles.requirementButtonContainer}>
              <Button
                className={styles.requirementButton}
                onClick={() => setActiveRequirement("minimum")}
                theme={activeRequirement === "minimum" ? "primary" : "outline"}
              >
                {t("minimum")}
              </Button>
              <Button
                className={styles.requirementButton}
                onClick={() => setActiveRequirement("recommended")}
                theme={
                  activeRequirement === "recommended" ? "primary" : "outline"
                }
              >
                {t("recommended")}
              </Button>
            </div>
            <div
              className={styles.requirementsDetails}
              dangerouslySetInnerHTML={{
                __html:
                  gameDetails?.pc_requirements?.[activeRequirement] ??
                  t(`no_${activeRequirement}_requirements`, {
                    title: gameDetails?.name,
                  }),
              }}
            ></div>
          </div>
        </div>
      </section>
    </>
  );
}
