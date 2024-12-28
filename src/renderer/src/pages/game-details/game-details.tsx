import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import type { GameRepack, GameShop, Steam250Game } from "@types";

import { Button, ConfirmationModal } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";

import starsIconAnimated from "@renderer/assets/icons/stars-animated.gif";

import { useTranslation } from "react-i18next";
import { SkeletonTheme } from "react-loading-skeleton";
import { GameDetailsSkeleton } from "./game-details-skeleton";
import * as styles from "./game-details.css";

import { vars } from "@renderer/theme.css";

import { GameDetailsContent } from "./game-details-content";
import {
  CloudSyncContextConsumer,
  CloudSyncContextProvider,
  GameDetailsContextConsumer,
  GameDetailsContextProvider,
} from "@renderer/context";
import { useDownload } from "@renderer/hooks";
import { GameOptionsModal, RepacksModal } from "./modals";
import { Downloader, getDownloadersForUri } from "@shared";
import { CloudSyncModal } from "./cloud-sync-modal/cloud-sync-modal";
import { CloudSyncFilesModal } from "./cloud-sync-files-modal/cloud-sync-files-modal";

export default function GameDetails() {
  const [randomGame, setRandomGame] = useState<Steam250Game | null>(null);
  const [randomizerLocked, setRandomizerLocked] = useState(false);

  const { objectId, shop } = useParams();
  const [searchParams] = useSearchParams();

  const fromRandomizer = searchParams.get("fromRandomizer");
  const gameTitle = searchParams.get("title");

  const { startDownload } = useDownload();

  const { t } = useTranslation("game_details");

  const navigate = useNavigate();

  useEffect(() => {
    setRandomGame(null);
    window.electron.getRandomGame().then((randomGame) => {
      setRandomGame(randomGame);
    });
  }, [objectId]);

  const handleRandomizerClick = () => {
    if (randomGame) {
      navigate(
        buildGameDetailsPath(
          { ...randomGame, shop: "steam" },
          { fromRandomizer: "1" }
        )
      );

      setRandomizerLocked(true);

      const zero = performance.now();

      requestAnimationFrame(function animateLock(time) {
        if (time - zero <= 1000) {
          requestAnimationFrame(animateLock);
        } else {
          setRandomizerLocked(false);
        }
      });
    }
  };

  const selectRepackUri = (repack: GameRepack, downloader: Downloader) =>
    repack.uris.find((uri) => getDownloadersForUri(uri).includes(downloader))!;

  return (
    <GameDetailsContextProvider
      gameTitle={gameTitle!}
      shop={shop! as GameShop}
      objectId={objectId!}
    >
      <GameDetailsContextConsumer>
        {({
          isLoading,
          game,
          gameTitle,
          shop,
          showRepacksModal,
          showGameOptionsModal,
          hasNSFWContentBlocked,
          setHasNSFWContentBlocked,
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
              objectId: objectId!,
              title: gameTitle,
              downloader,
              shop: shop as GameShop,
              downloadPath,
              uri: selectRepackUri(repack, downloader),
            });

            await updateGame();
            setShowRepacksModal(false);
            setShowGameOptionsModal(false);
          };

          const handleNSFWContentRefuse = () => {
            setHasNSFWContentBlocked(false);
            navigate(-1);
          };

          return (
            <CloudSyncContextProvider
              objectId={objectId!}
              shop={shop! as GameShop}
            >
              <CloudSyncContextConsumer>
                {({
                  showCloudSyncModal,
                  setShowCloudSyncModal,
                  showCloudSyncFilesModal,
                  setShowCloudSyncFilesModal,
                }) => (
                  <>
                    <CloudSyncModal
                      onClose={() => setShowCloudSyncModal(false)}
                      visible={showCloudSyncModal}
                    />

                    <CloudSyncFilesModal
                      onClose={() => setShowCloudSyncFilesModal(false)}
                      visible={showCloudSyncFilesModal}
                    />
                  </>
                )}
              </CloudSyncContextConsumer>

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

                <ConfirmationModal
                  visible={hasNSFWContentBlocked}
                  onClose={handleNSFWContentRefuse}
                  title={t("nsfw_content_title")}
                  descriptionText={t("nsfw_content_description", {
                    title: gameTitle,
                  })}
                  confirmButtonLabel={t("allow_nsfw_content")}
                  cancelButtonLabel={t("refuse_nsfw_content")}
                  onConfirm={() => setHasNSFWContentBlocked(false)}
                  clickOutsideToClose={false}
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
                    disabled={!randomGame || randomizerLocked}
                  >
                    <div
                      style={{ width: 16, height: 16, position: "relative" }}
                    >
                      <img
                        src={starsIconAnimated}
                        alt="Stars animation"
                        style={{
                          width: 70,
                          position: "absolute",
                          top: -28,
                          left: -27,
                        }}
                      />
                    </div>
                    {t("next_suggestion")}
                  </Button>
                )}
              </SkeletonTheme>
            </CloudSyncContextProvider>
          );
        }}
      </GameDetailsContextConsumer>
    </GameDetailsContextProvider>
  );
}
