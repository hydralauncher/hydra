import { useCallback, useContext, useEffect, useRef } from "react";

import { Sidebar, BottomPanel, Header, Toast } from "@renderer/components";

import Intercom from "@intercom/messenger-js-sdk";

import {
  useAppDispatch,
  useAppSelector,
  useDownload,
  useLibrary,
  useToast,
  useUserDetails,
} from "@renderer/hooks";

import * as styles from "./app.css";

import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  setSearch,
  clearSearch,
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
import { repacksContext } from "./context";
import { logger } from "./logger";

export interface AppProps {
  children: React.ReactNode;
}

Intercom({
  app_id: import.meta.env.RENDERER_VITE_INTERCOM_APP_ID,
});

export function App() {
  const contentRef = useRef<HTMLDivElement>(null);
  const { updateLibrary, library } = useLibrary();

  const { t } = useTranslation("app");

  const downloadSourceMigrationLock = useRef(false);

  const { clearDownload, setLastPacket } = useDownload();

  const { indexRepacks } = useContext(repacksContext);

  const {
    isFriendsModalVisible,
    friendRequetsModalTab,
    friendModalUserId,
    syncFriendRequests,
    hideFriendsModal,
  } = useUserDetails();

  const {
    userDetails,
    hasActiveSubscription,
    fetchUserDetails,
    updateUserDetails,
    clearUserDetails,
  } = useUserDetails();

  const dispatch = useAppDispatch();

  const navigate = useNavigate();
  const location = useLocation();

  const search = useAppSelector((state) => state.search.value);

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
        if (downloadProgress.game.progress === 1) {
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

    fetchUserDetails().then((response) => {
      if (response) {
        updateUserDetails(response);
        syncFriendRequests();
      }
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

  const handleSearch = useCallback(
    (query: string) => {
      dispatch(setSearch(query));

      if (query === "") {
        navigate(-1);
        return;
      }

      const searchParams = new URLSearchParams({
        query,
      });

      navigate(`/search?${searchParams.toString()}`, {
        replace: location.pathname.startsWith("/search"),
      });
    },
    [dispatch, location.pathname, navigate]
  );

  const handleClear = useCallback(() => {
    dispatch(clearSearch());
    navigate(-1);
  }, [dispatch, navigate]);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [location.pathname, location.search]);

  useEffect(() => {
    new MutationObserver(() => {
      const modal = document.body.querySelector(
        "[role=dialog]:not([data-intercom-frame='true'])"
      );

      dispatch(toggleDraggingDisabled(Boolean(modal)));
    }).observe(document.body, {
      attributes: false,
      childList: true,
    });
  }, [dispatch, draggingDisabled]);

  useEffect(() => {
    if (downloadSourceMigrationLock.current) return;

    downloadSourceMigrationLock.current = true;

    window.electron.getDownloadSources().then(async (downloadSources) => {
      if (!downloadSources.length) {
        const id = crypto.randomUUID();
        const channel = new BroadcastChannel(`download_sources:sync:${id}`);

        channel.onmessage = (event: MessageEvent<number>) => {
          const newRepacksCount = event.data;
          window.electron.publishNewRepacksNotification(newRepacksCount);
        };

        downloadSourcesWorker.postMessage(["SYNC_DOWNLOAD_SOURCES", id]);
      }

      for (const downloadSource of downloadSources) {
        logger.info("Migrating download source", downloadSource.url);

        const channel = new BroadcastChannel(
          `download_sources:import:${downloadSource.url}`
        );
        await new Promise((resolve) => {
          downloadSourcesWorker.postMessage([
            "IMPORT_DOWNLOAD_SOURCE",
            downloadSource.url,
          ]);

          channel.onmessage = () => {
            window.electron.deleteDownloadSource(downloadSource.id).then(() => {
              resolve(true);
              logger.info(
                "Deleted download source from SQLite",
                downloadSource.url
              );
            });

            indexRepacks();
            channel.close();
          };
        }).catch(() => channel.close());
      }

      downloadSourceMigrationLock.current = false;
    });
  }, [indexRepacks]);

  const handleToastClose = useCallback(() => {
    dispatch(closeToast());
  }, [dispatch]);

  return (
    <>
      {window.electron.platform === "win32" && (
        <div className={styles.titleBar}>
          <h4>
            Hydra
            {hasActiveSubscription && (
              <span className={styles.cloudText}> Cloud</span>
            )}
          </h4>
        </div>
      )}

      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onClose={handleToastClose}
      />

      {userDetails && (
        <UserFriendModal
          visible={isFriendsModalVisible}
          initialTab={friendRequetsModalTab}
          onClose={hideFriendsModal}
          userId={friendModalUserId}
        />
      )}

      <main>
        <Sidebar />

        <article className={styles.container}>
          <Header
            onSearch={handleSearch}
            search={search}
            onClear={handleClear}
          />

          <section ref={contentRef} className={styles.content}>
            <Outlet />
          </section>
        </article>
      </main>

      <BottomPanel />
    </>
  );
}
