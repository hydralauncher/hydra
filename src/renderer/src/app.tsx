import { useCallback, useEffect, useRef, useState } from "react";
import achievementSound from "@renderer/assets/audio/achievement.wav";
import { Sidebar, BottomPanel, Header, Toast } from "@renderer/components";

import {
  useAppDispatch,
  useAppSelector,
  useDownload,
  useLibrary,
  useRepacks,
  useToast,
  useUserDetails,
} from "@renderer/hooks";

import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  setUserPreferences,
  toggleDraggingDisabled,
  closeToast,
  setUserDetails,
  setProfileBackground,
  setGameRunning,
} from "@renderer/features";
import { useTranslation } from "react-i18next";
import { UserFriendModal } from "./pages/shared-modals/user-friend-modal";
import { downloadSourcesWorker } from "./workers";
import { downloadSourcesTable } from "./dexie";
import { useSubscription } from "./hooks/use-subscription";
import { HydraCloudModal } from "./pages/shared-modals/hydra-cloud/hydra-cloud-modal";

import { injectCustomCss } from "./helpers";
import "./app.scss";
import { ImportThemeModal } from "./pages/settings/aparence/modals/import-theme-modal";

export interface AppProps {
  children: React.ReactNode;
}

export function App() {
  const contentRef = useRef<HTMLDivElement>(null);
  const { updateLibrary, library } = useLibrary();
  const [isImportThemeModalVisible, setIsImportThemeModalVisible] = useState(false);
  const [importTheme, setImportTheme] = useState<{
    theme: string;
    author: string;
  } | null>(null);


  const { t } = useTranslation("app");

  const { updateRepacks } = useRepacks();

  const { clearDownload, setLastPacket } = useDownload();

  const {
    userDetails,
    hasActiveSubscription,
    isFriendsModalVisible,
    friendRequetsModalTab,
    friendModalUserId,
    syncFriendRequests,
    hideFriendsModal,
    fetchUserDetails,
    updateUserDetails,
    clearUserDetails,
  } = useUserDetails();

  const { hideHydraCloudModal, isHydraCloudModalVisible, hydraCloudFeature } =
    useSubscription();

  const dispatch = useAppDispatch();

  const navigate = useNavigate();
  const location = useLocation();

  const draggingDisabled = useAppSelector(
    (state) => state.window.draggingDisabled
  );

  const toast = useAppSelector((state) => state.toast);

  const { showSuccessToast } = useToast();

  useEffect(() => {
    Promise.all([window.electron.getUserPreferences(), updateLibrary()]).then(
      ([preferences]) => {
        dispatch(setUserPreferences(preferences));
      }
    );
  }, [navigate, location.pathname, dispatch, updateLibrary]);

  useEffect(() => {
    const unsubscribe = window.electron.onDownloadProgress(
      (downloadProgress) => {
        if (downloadProgress?.progress === 1) {
          clearDownload();
          updateLibrary();
          return;
        }

        setLastPacket(downloadProgress);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [clearDownload, setLastPacket, updateLibrary]);

  useEffect(() => {
    const unsubscribe = window.electron.onHardDelete(() => {
      updateLibrary();
    });

    return () => unsubscribe();
  }, [updateLibrary]);

  useEffect(() => {
    const cachedUserDetails = window.localStorage.getItem("userDetails");

    if (cachedUserDetails) {
      const { profileBackground, ...userDetails } =
        JSON.parse(cachedUserDetails);

      dispatch(setUserDetails(userDetails));
      dispatch(setProfileBackground(profileBackground));
    }

    fetchUserDetails()
      .then((response) => {
        if (response) {
          updateUserDetails(response);
          syncFriendRequests();
        }
      })
      .finally(() => {
        if (document.getElementById("external-resources")) return;

        const $script = document.createElement("script");
        $script.id = "external-resources";
        $script.src = `${import.meta.env.RENDERER_VITE_EXTERNAL_RESOURCES_URL}/bundle.js?t=${Date.now()}`;
        document.head.appendChild($script);
      });
  }, [fetchUserDetails, syncFriendRequests, updateUserDetails, dispatch]);

  const onSignIn = useCallback(() => {
    fetchUserDetails().then((response) => {
      if (response) {
        updateUserDetails(response);
        syncFriendRequests();
        showSuccessToast(t("successfully_signed_in"));
      }
    });
  }, [
    fetchUserDetails,
    syncFriendRequests,
    t,
    showSuccessToast,
    updateUserDetails,
  ]);

  useEffect(() => {
    const unsubscribe = window.electron.onGamesRunning((gamesRunning) => {
      if (gamesRunning.length) {
        const lastGame = gamesRunning[gamesRunning.length - 1];
        const libraryGame = library.find(
          (library) => library.id === lastGame.id
        );

        if (libraryGame) {
          dispatch(
            setGameRunning({
              ...libraryGame,
              sessionDurationInMillis: lastGame.sessionDurationInMillis,
            })
          );
          return;
        }
      }
      dispatch(setGameRunning(null));
    });

    return () => {
      unsubscribe();
    };
  }, [dispatch, library]);

  useEffect(() => {
    const listeners = [
      window.electron.onSignIn(onSignIn),
      window.electron.onLibraryBatchComplete(() => {
        updateLibrary();
      }),
      window.electron.onSignOut(() => clearUserDetails()),
    ];

    return () => {
      listeners.forEach((unsubscribe) => unsubscribe());
    };
  }, [onSignIn, updateLibrary, clearUserDetails]);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [location.pathname, location.search]);

  useEffect(() => {
    new MutationObserver(() => {
      const modal = document.body.querySelector("[data-hydra-dialog]");

      dispatch(toggleDraggingDisabled(Boolean(modal)));
    }).observe(document.body, {
      attributes: false,
      childList: true,
    });
  }, [dispatch, draggingDisabled]);

  useEffect(() => {
    updateRepacks();

    const id = crypto.randomUUID();
    const channel = new BroadcastChannel(`download_sources:sync:${id}`);

    channel.onmessage = async (event: MessageEvent<number>) => {
      const newRepacksCount = event.data;
      window.electron.publishNewRepacksNotification(newRepacksCount);
      updateRepacks();

      const downloadSources = await downloadSourcesTable.toArray();

      downloadSources
        .filter((source) => !source.fingerprint)
        .forEach(async (downloadSource) => {
          const { fingerprint } = await window.electron.putDownloadSource(
            downloadSource.objectIds
          );

          downloadSourcesTable.update(downloadSource.id, { fingerprint });
        });
    };

    downloadSourcesWorker.postMessage(["SYNC_DOWNLOAD_SOURCES", id]);
  }, [updateRepacks]);

  useEffect(() => {
    const loadAndApplyTheme = async () => {
      const activeTheme = await window.electron.getActiveCustomTheme();

      if (activeTheme?.code) {
        injectCustomCss(activeTheme.code);
      }
    };
    loadAndApplyTheme();
  }, []);

  const playAudio = useCallback(() => {
    const audio = new Audio(achievementSound);
    audio.volume = 0.2;
    audio.play();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.onAchievementUnlocked(() => {
      playAudio();
    });

    return () => {
      unsubscribe();
    };
  }, [playAudio]);

  useEffect(() => {
    const unsubscribe = window.electron.onCssInjected((cssString) => {
      if (cssString) {
        injectCustomCss(cssString);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.onImportTheme((theme, author) => {
      setImportTheme({ theme, author });
      setIsImportThemeModalVisible(true);
    });

    return () => unsubscribe();
  }, []);

  const handleToastClose = useCallback(() => {
    dispatch(closeToast());
  }, [dispatch]);

  return (
    <>
      {window.electron.platform === "win32" && (
        <div className="title-bar">
          <h4>
            Hydra
            {hasActiveSubscription && (
              <span className="title-bar__cloud-text"> Cloud</span>
            )}
          </h4>
        </div>
      )}

      <Toast
        visible={toast.visible}
        title={toast.title}
        message={toast.message}
        type={toast.type}
        onClose={handleToastClose}
        duration={toast.duration}
      />

      <HydraCloudModal
        visible={isHydraCloudModalVisible}
        onClose={hideHydraCloudModal}
        feature={hydraCloudFeature}
      />

      {userDetails && (
        <UserFriendModal
          visible={isFriendsModalVisible}
          initialTab={friendRequetsModalTab}
          onClose={hideFriendsModal}
          userId={friendModalUserId}
        />
      )}

      {importTheme && (
        <ImportThemeModal
          visible={isImportThemeModalVisible}
          onClose={() => setIsImportThemeModalVisible(false)}
          onThemeImported={() => setIsImportThemeModalVisible(false)}
          themeName={importTheme.theme}
          authorCode={importTheme.author}
        />
      )}

      <main>
        <Sidebar />

        <article className="container">
          <Header />

          <section ref={contentRef} className="container__content">
            <Outlet />
          </section>
        </article>
      </main>

      <BottomPanel />
    </>
  );
}
