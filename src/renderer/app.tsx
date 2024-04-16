import { useCallback, useEffect, useRef } from "react";

import { Sidebar, BottomPanel, Header } from "@renderer/components";

import {
  useAppDispatch,
  useAppSelector,
  useDownload,
  useLibrary,
} from "@renderer/hooks";

import * as styles from "./app.css";
import { themeClass } from "./theme.css";

import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  setSearch,
  clearSearch,
  setUserPreferences,
  setRepackersFriendlyNames,
} from "@renderer/features";

document.body.classList.add(themeClass);

export function App() {
  const contentRef = useRef<HTMLDivElement>(null);
  const { updateLibrary } = useLibrary();

  const { clearDownload, addPacket } = useDownload();

  const dispatch = useAppDispatch();

  const navigate = useNavigate();
  const location = useLocation();

  const search = useAppSelector((state) => state.search.value);

  useEffect(() => {
    Promise.all([
      window.electron.getUserPreferences(),
      window.electron.getRepackersFriendlyNames(),
      updateLibrary(),
    ]).then(([preferences, repackersFriendlyNames]) => {
      dispatch(setUserPreferences(preferences));
      dispatch(setRepackersFriendlyNames(repackersFriendlyNames));
    });
  }, [navigate, location.pathname, dispatch, updateLibrary]);

  useEffect(() => {
    const unsubscribe = window.electron.onDownloadProgress(
      (downloadProgress) => {
        if (downloadProgress.game.progress === 1) {
          clearDownload();
          updateLibrary();
          return;
        }

        addPacket(downloadProgress);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [clearDownload, addPacket, updateLibrary]);

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
  }, [location.pathname]);

  return (
    <>
      {window.electron.platform === "win32" && (
        <div className={styles.titleBar}>
          <h4>Hydra</h4>
        </div>
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
