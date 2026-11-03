import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type {
  LibraryGame,
  RecompilationDetails,
  RecompilationReadme,
  RecompilationRelease,
} from "@types";
import { pickRecompilationInstallAsset } from "@shared";

import { useAppDispatch, useUserDetails } from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import { logger } from "@renderer/logger";
import { GameReviews } from "../game-details/game-reviews";
import { useUserReviewStatus } from "../game-details/use-user-review-status";
import { RecompilationHero } from "./recompilation-hero";
import { RecompilationInstallModal } from "./recompilation-install-modal";
import { RomDownloadModal } from "./rom-download-modal";
import { RecompilationSidebar } from "./recompilation-sidebar";
import { RecompilationTabBar } from "./recompilation-tab-bar";
import {
  RecompilationNewsTab,
  RecompilationReadmeSection,
  releaseAnchor,
} from "./recompilation-tabs";
import {
  getRecompilation,
  getRecompilationReadme,
  getRecompilationReleases,
} from "./recompilations-api";
import { useRecompilationInstall } from "./use-recompilation-install";
import { useRecompilationRom } from "./use-recompilation-rom";
import "./recompilation-page.scss";

type RecompilationTab = "about" | "news";

export default function RecompilationPage() {
  const { objectId = "", slug = "" } = useParams();
  const { t } = useTranslation("recompilation");
  const { userDetails } = useUserDetails();

  const [details, setDetails] = useState<RecompilationDetails | null>(null);
  const [readme, setReadme] = useState<RecompilationReadme | null>(null);
  const [releases, setReleases] = useState<RecompilationRelease[]>([]);
  const [game, setGame] = useState<LibraryGame | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);
  const [activeTab, setActiveTab] = useState<RecompilationTab>("about");
  // A release picked in the sidebar; scrolled to once the feed has rendered.
  const [scrollToRelease, setScrollToRelease] = useState<string | null>(null);

  useEffect(() => {
    if (!scrollToRelease || activeTab !== "news") return;
    // The notes collapse after their first render, which moves every release
    // below them, so wait for the feed to settle before scrolling.
    const timeout = window.setTimeout(() => {
      document
        .getElementById(releaseAnchor(scrollToRelease))
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      setScrollToRelease(null);
    }, 150);
    return () => window.clearTimeout(timeout);
  }, [scrollToRelease, activeTab]);

  const install = useRecompilationInstall(objectId, slug);
  const rom = useRecompilationRom(objectId, slug);
  const [searchParams, setSearchParams] = useSearchParams();
  const [isInstallOpen, setIsInstallOpen] = useState(false);
  const [isRomDownloadOpen, setIsRomDownloadOpen] = useState(false);

  // Moving to another port reuses this page, so close its modals.
  useEffect(() => {
    setIsInstallOpen(false);
    setIsRomDownloadOpen(false);
  }, [objectId, slug]);

  // The game page sends ?rom=1 when a port has no ROM yet.
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
    setReadme(null);
    setReleases([]);
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

    getRecompilationReadme(objectId, slug)
      .then((data) => {
        if (!cancelled) setReadme(data);
      })
      .catch((error) => logger.error("Failed to load README", error));

    getRecompilationReleases(objectId, slug)
      .then((data) => {
        if (!cancelled) setReleases(data.releases ?? []);
      })
      .catch((error) => logger.error("Failed to load releases", error));

    window.electron
      .getGameByObjectId("launchbox", objectId)
      .then((libraryGame) => {
        if (!cancelled) setGame(libraryGame);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [objectId, slug]);

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

  const { hasUserReviewed, isCheckingUserReview, updateHasUserReviewed } =
    useUserReviewStatus({
      shop: "launchbox",
      objectId,
      userDetailsId: userDetails?.id,
      recompilationSlug: slug,
    });

  if (isNotFound) {
    return (
      <div className="recompilation-page recompilation-page--empty">
        <p>{t("not_found")}</p>
      </div>
    );
  }

  if (!details) {
    return <div className="recompilation-page" aria-busy="true" />;
  }

  const selectRelease = (tag: string) => {
    setActiveTab("news");
    setScrollToRelease(tag);
  };

  return (
    <div className="recompilation-page">
      <RecompilationHero
        details={details}
        installAsset={installAsset}
        install={install}
        rom={rom}
        onOpenInstall={() => setIsInstallOpen(true)}
        onDownloadRom={() => setIsRomDownloadOpen(true)}
      />

      <RecompilationInstallModal
        visible={isInstallOpen && rom.state?.handlesRom === true}
        details={details}
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
            { id: "news", label: t("tab_news") },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
        />
      </div>

      <div className="game-details__description-container">
        <div className="game-details__description-content">
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

          {activeTab === "news" && (
            <RecompilationNewsTab details={details} releases={releases} />
          )}
        </div>

        <RecompilationSidebar
          details={details}
          installAsset={installAsset}
          install={install}
          rom={rom}
          releases={releases}
          onSelectRelease={selectRelease}
        />
      </div>
    </div>
  );
}
