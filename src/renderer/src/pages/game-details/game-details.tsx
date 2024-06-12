import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { GameRepack, GameShop, Steam250Game } from "@types";

import { Button } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";

import starsAnimation from "@renderer/assets/lottie/stars.json";

import Lottie from "lottie-react";
import { useTranslation } from "react-i18next";
import { SkeletonTheme } from "react-loading-skeleton";
import { GameDetailsSkeleton } from "./game-details-skeleton";
import * as styles from "./game-details.css";

import { vars } from "@renderer/theme.css";

import { GameDetailsContent } from "./game-details-content";
import {
  GameDetailsContextConsumer,
  GameDetailsContextProvider,
} from "@renderer/context";
import { useDownload } from "@renderer/hooks";
import { GameOptionsModal, RepacksModal } from "./modals";
import { Downloader } from "@shared";

export function GameDetails() {
  const [randomGame, setRandomGame] = useState<Steam250Game | null>(null);

  const { objectID } = useParams();
  const [searchParams] = useSearchParams();

  const fromRandomizer = searchParams.get("fromRandomizer");

  const { startDownload } = useDownload();

  const { t } = useTranslation("game_details");

  const navigate = useNavigate();

  useEffect(() => {
    setRandomGame(null);
    window.electron.getRandomGame().then((randomGame) => {
      setRandomGame(randomGame);
    });
  }, [objectID]);

  const handleRandomizerClick = () => {
    if (randomGame) {
      navigate(
        buildGameDetailsPath(
          { ...randomGame, shop: "steam" },
          { fromRandomizer: "1" }
        )
      );
    }
  };

  return (
    <GameDetailsContextProvider>
      <GameDetailsContextConsumer>
        {({
          isLoading,
          game,
          gameTitle,
          shop,
          showRepacksModal,
          showGameOptionsModal,
          updateGame,
          setShowRepacksModal,
          setShowGameOptionsModal,
        }) => {
          const handleStartDownload = async (
            repack: GameRepack,
            downloader: Downloader,
            downloadPath: string
          ) => {
            await startDownload({
              repackId: repack.id,
              objectID: objectID!,
              title: gameTitle,
              downloader,
              shop: shop as GameShop,
              downloadPath,
            });

            await updateGame();
            setShowRepacksModal(false);
            setShowGameOptionsModal(false);
          };

          return (
            <SkeletonTheme
              baseColor={vars.color.background}
              highlightColor="#444"
            >
              {isLoading ? <GameDetailsSkeleton /> : <GameDetailsContent />}

              <RepacksModal
                visible={showRepacksModal}
                startDownload={handleStartDownload}
                onClose={() => setShowRepacksModal(false)}
              />

              {game && (
                <GameOptionsModal
                  visible={showGameOptionsModal}
                  game={game}
                  onClose={() => {
                    setShowGameOptionsModal(false);
                  }}
                />
              )}

              {fromRandomizer && (
                <Button
                  className={styles.randomizerButton}
                  onClick={handleRandomizerClick}
                  theme="outline"
                  disabled={!randomGame}
                >
                  <div style={{ width: 16, height: 16, position: "relative" }}>
                    <Lottie
                      animationData={starsAnimation}
                      style={{
                        width: 70,
                        position: "absolute",
                        top: -28,
                        left: -27,
                      }}
                      loop
                    />
                  </div>
                  {t("next_suggestion")}
                </Button>
              )}
            </SkeletonTheme>
          );
        }}
      </GameDetailsContextConsumer>
    </GameDetailsContextProvider>
  );
}
