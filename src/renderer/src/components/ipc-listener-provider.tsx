import { useCallback, useEffect } from "react";
import { Outlet } from "react-router-dom";
import {
  useAppDispatch,
  useDownload,
  useLibrary,
  useUserDetails,
} from "@renderer/hooks";
import {
  setUserDetails,
  setProfileBackground,
  setGameRunning,
  setExtractionProgress,
  clearExtraction,
} from "@renderer/features";
import {
  getAchievementSoundUrl,
  getAchievementSoundVolume,
} from "@renderer/helpers";

export function IPCListenerProvider() {
  const dispatch = useAppDispatch();
  const { updateLibrary, library } = useLibrary();
  const { clearDownload, setLastPacket } = useDownload();
  const { fetchUserDetails, updateUserDetails, clearUserDetails } =
    useUserDetails();

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

  const setupExternalResources = useCallback(async () => {
    const cachedUserDetails = window.localStorage.getItem("userDetails");

    if (cachedUserDetails) {
      const { profileBackground, ...userDetails } =
        JSON.parse(cachedUserDetails);

      dispatch(setUserDetails(userDetails));
      dispatch(setProfileBackground(profileBackground));
    }

    const userDetails = await fetchUserDetails().catch(() => null);

    if (userDetails) {
      updateUserDetails(userDetails);
    }

    if (!document.getElementById("external-resources")) {
      const $script = document.createElement("script");
      $script.id = "external-resources";
      $script.src = `${import.meta.env.RENDERER_VITE_EXTERNAL_RESOURCES_URL}/bundle.js?t=${Date.now()}`;
      document.head.appendChild($script);
    }
  }, [fetchUserDetails, updateUserDetails, dispatch]);

  useEffect(() => {
    setupExternalResources();
  }, [setupExternalResources]);

  const onSignIn = useCallback(() => {
    fetchUserDetails().then((response) => {
      if (response) {
        updateUserDetails(response);
      }
    });
  }, [fetchUserDetails, updateUserDetails]);

  useEffect(() => {
    const listeners = [
      window.electron.onSignIn(onSignIn),
      window.electron.onLibraryBatchComplete(() => {
        updateLibrary();
      }),
      window.electron.onSignOut(() => clearUserDetails()),
      window.electron.onExtractionProgress((shop, objectId, progress) => {
        dispatch(setExtractionProgress({ shop, objectId, progress }));
      }),
      window.electron.onExtractionComplete(() => {
        dispatch(clearExtraction());
        updateLibrary();
      }),
    ];

    return () => {
      listeners.forEach((unsubscribe) => unsubscribe());
    };
  }, [onSignIn, updateLibrary, clearUserDetails, dispatch]);

  const playAudio = useCallback(async () => {
    const soundUrl = await getAchievementSoundUrl();
    const volume = await getAchievementSoundVolume();
    const audio = new Audio(soundUrl);
    audio.volume = volume;
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

  return <Outlet />;
}
