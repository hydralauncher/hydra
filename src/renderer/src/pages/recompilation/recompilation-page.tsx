import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type {
  LibraryGame,
  RecompilationDetails,
  RecompilationReadme,
  RecompilationRelease,
} from "@types";
import {
  pickRecompilationInstallAsset,
  toRecompilationCloudSaveObjectId,
} from "@shared";

import { useAppDispatch, useFeature, useUserDetails } from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import { logger } from "@renderer/logger";
import { CloudSaveV2Provider } from "../game-details/cloud-save-v2";
import { GameReviews } from "../game-details/game-reviews";
import { useUserReviewStatus } from "../game-details/use-user-review-status";
import { RecompilationHero } from "./recompilation-hero";
import { RecompilationInstallModal } from "./recompilation-install-modal";
import { RomDownloadModal } from "./rom-download-modal";
import { RecompilationSidebar } from "./recompilation-sidebar";
import { RecompilationTabBar } from "./recompilation-tab-bar";
import {
  RecompilationReadmeSection,
  RecompilationReleasesTab,
} from "./recompilation-tabs";
import {
  getRecompilation,
  getRecompilationReadme,
  getRecompilationReleases,
} from "./recompilations-api";
import { useRecompilationInstall } from "./use-recompilation-install";
import { useRecompilationRom } from "./use-recompilation-rom";
import "./recompilation-page.scss";

type RecompilationTab = "about" | "releases";

export default function RecompilationPage() {
  const { objectId = "", slug = "" } = useParams();
  const { t, i18n } = useTranslation("recompilation");
  const { userDetails } = useUserDetails();
  const { isFeatureEnabled, isFeaturesSettled, Feature } = useFeature();
  const isRecompilationsEnabled = isFeatureEnabled(Feature.Recompilations);
  const isCloudSaveEnabled = isFeatureEnabled(Feature.RecompilationCloudSaves);

  const [details, setDetails] = useState<RecompilationDetails | null>(null);
  const [readme, setReadme] = useState<RecompilationReadme | null>(null);
  const [releases, setReleases] = useState<RecompilationRelease[]>([]);
  const [areReleasesLoaded, setAreReleasesLoaded] = useState(false);
  const [game, setGame] = useState<LibraryGame | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);
  const [activeTab, setActiveTab] = useState<RecompilationTab>("about");

  const install = useRecompilationInstall(objectId, slug);
  const rom = useRecompilationRom(objectId, slug);
  const [searchParams, setSearchParams] = useSearchParams();
  const [isInstallOpen, setIsInstallOpen] = useState(false);
  const [isRomDownloadOpen, setIsRomDownloadOpen] = useState(false);

  useEffect(() => {
    setIsInstallOpen(false);
    setIsRomDownloadOpen(false);
  }, [objectId, slug]);

  useEffect(() => {
    if (searchParams.get("rom") !== "1") return;
    setIsInstallOpen(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (details) dispatch(setHeaderTitle(details.name));
  }, [dispatch, details]);

  useEffect(() => {
    let cancelled = false;
    setDetails(null);
    setReleases([]);
    setAreReleasesLoaded(false);
    setIsNotFound(false);
    setActiveTab("about");

    getRecompilation(objectId, slug)
      .then((data) => {
        if (!cancelled) setDetails(data);
      })
      .catch((error) => {
        logger.error("Failed to load recompilation", error);
        if (!cancelled) setIsNotFound(true);
      });

    getRecompilationReleases(objectId, slug)
      .then((data) => {
        if (cancelled) return;
        setReleases(data.releases ?? []);
        setAreReleasesLoaded(true);
      })
      .catch((error) => logger.error("Failed to load releases", error));

    return () => {
      cancelled = true;
    };
  }, [objectId, slug]);

  // The README comes translated to the launcher's language when there is a
  // translation, so it is fetched again when the language changes.
  useEffect(() => {
    let cancelled = false;
    setReadme(null);

    getRecompilationReadme(objectId, slug, i18n.language)
      .then((data) => {
        if (!cancelled) setReadme(data);
      })
      .catch((error) => logger.error("Failed to load README", error));

    return () => {
      cancelled = true;
    };
  }, [objectId, slug, i18n.language]);

  useEffect(() => {
    let cancelled = false;
    const loadGame = () => {
      window.electron
        .getGameByObjectId("launchbox", objectId)
        .then((libraryGame) => {
          if (!cancelled) setGame(libraryGame);
        })
        .catch(() => {});
    };

    setGame(null);
    loadGame();
    const unsubscribe = window.electron.onLibraryBatchComplete(loadGame);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [objectId]);

  const latestRelease = useMemo(
    () => releases.find((release) => release.isLatest) ?? releases[0] ?? null,
    [releases]
  );
  const installAsset = useMemo(
    () =>
      latestRelease
        ? pickRecompilationInstallAsset(
            latestRelease.assets,
            window.electron.platform
          )
        : null,
    [latestRelease]
  );

  const cloudSaveObjectId = toRecompilationCloudSaveObjectId(objectId, slug);
  const installState = install.state;
  const cloudSaveGame = useMemo<LibraryGame | null>(() => {
    if (
      !isCloudSaveEnabled ||
      !details ||
      !installState?.installed ||
      !installState.hasCloudSaves ||
      !installState.executablePath
    ) {
      return null;
    }
    return {
      id: `launchbox:${cloudSaveObjectId}`,
      shop: "launchbox",
      objectId: cloudSaveObjectId,
      title: details.game.title,
      iconUrl: details.iconUrl ?? null,
      libraryHeroImageUrl: details.game.libraryHeroImageUrl ?? null,
      logoImageUrl: null,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      remoteId: null,
      isDeleted: false,
      executablePath: installState.executablePath,
      download: null,
    };
  }, [isCloudSaveEnabled, details, installState, cloudSaveObjectId]);

  const { hasUserReviewed, isCheckingUserReview, updateHasUserReviewed } =
    useUserReviewStatus({
      shop: "launchbox",
      objectId,
      userDetailsId: userDetails?.id,
      recompilationSlug: slug,
    });

  if (!isRecompilationsEnabled && !isFeaturesSettled) {
    return <div className="recompilation-page" aria-busy="true" />;
  }

  if (isNotFound || !isRecompilationsEnabled) {
    return (
      <div className="recompilation-page recompilation-page--empty">
        <p>{t("not_found")}</p>
      </div>
    );
  }

  if (!details) {
    return <div className="recompilation-page" aria-busy="true" />;
  }

  return (
    <CloudSaveV2Provider
      objectId={cloudSaveObjectId}
      shop="launchbox"
      game={cloudSaveGame}
      isGameRunning={install.isRunning}
    >
      <div className="recompilation-page">
        <RecompilationHero
          objectId={objectId}
          details={details}
          areReleasesLoaded={areReleasesLoaded}
          game={game}
          hasCloudSave={cloudSaveGame !== null}
          installAsset={installAsset}
          install={install}
          rom={rom}
          onOpenInstall={() => setIsInstallOpen(true)}
          onDownloadRom={() => setIsRomDownloadOpen(true)}
        />

        <RecompilationInstallModal
          visible={isInstallOpen}
          details={details}
          installAsset={installAsset}
          install={install}
          rom={rom}
          onClose={() => setIsInstallOpen(false)}
        />

        <RomDownloadModal
          visible={isRomDownloadOpen}
          objectId={objectId}
          gameTitle={details.game.title}
          onStarted={() => setIsRomDownloadOpen(false)}
          onClose={() => setIsRomDownloadOpen(false)}
        />

        <div className="recompilation-page__body">
          <RecompilationTabBar
            tabs={[
              { id: "about", label: t("tab_about") },
              {
                id: "releases",
                label: t("tab_releases"),
                count: releases.length,
              },
            ]}
            activeTab={activeTab}
            onChange={setActiveTab}
          />
        </div>

        <div className="game-details__description-container">
          <div
            key={activeTab}
            className="game-details__description-content recompilation-page__tab-content"
          >
            {activeTab === "about" && (
              <>
                <RecompilationReadmeSection details={details} readme={readme} />
                <GameReviews
                  shop="launchbox"
                  objectId={objectId}
                  game={game}
                  userDetailsId={userDetails?.id}
                  hasUserReviewed={hasUserReviewed}
                  isCheckingUserReview={isCheckingUserReview}
                  onUserReviewedChange={updateHasUserReviewed}
                  recompilationSlug={slug}
                />
              </>
            )}

            {activeTab === "releases" && (
              <RecompilationReleasesTab details={details} releases={releases} />
            )}
          </div>

          <RecompilationSidebar
            details={details}
            installAsset={installAsset}
            install={install}
            rom={rom}
          />
        </div>
      </div>
    </CloudSaveV2Provider>
  );
}
