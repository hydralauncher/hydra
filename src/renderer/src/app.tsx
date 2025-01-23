import { useCallback, useEffect, useRef } from "react";

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

import "./app.scss";

export interface AppProps {
  children: React.ReactNode;
}

export function App() {
  const contentRef = useRef<HTMLDivElement>(null);
  const { updateLibrary, library } = useLibrary();

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
        if (downloadProgress.progress === 1) {
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

    channel.onmessage = (event: MessageEvent<number>) => {
      const newRepacksCount = event.data;
      window.electron.publishNewRepacksNotification(newRepacksCount);
      updateRepacks();

      downloadSourcesTable.toArray().then((downloadSources) => {
        downloadSources
          .filter((source) => !source.fingerprint)
          .forEach((downloadSource) => {
            window.electron
              .putDownloadSource(downloadSource.objectIds)
              .then(({ fingerprint }) => {
                downloadSourcesTable.update(downloadSource.id, { fingerprint });
              });
          });
      });
    };

    downloadSourcesWorker.postMessage(["SYNC_DOWNLOAD_SOURCES", id]);
  }, [updateRepacks]);

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
        message={toast.message}
        type={toast.type}
        onClose={handleToastClose}
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
