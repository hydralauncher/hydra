import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeftIcon, SearchIcon, XIcon } from "@primer/octicons-react";

import { useAppDispatch, useAppSelector } from "@renderer/hooks";

import * as styles from "./header.css";
import { clearSearch } from "@renderer/features";

export interface HeaderProps {
  onSearch: (query: string) => void;
  onClear: () => void;
  search?: string;
}

const pathTitle: Record<string, string> = {
  "/": "catalogue",
  "/downloads": "downloads",
  "/search": "search_results",
  "/settings": "settings",
};

export function Header({ onSearch, onClear, search }: HeaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const { headerTitle, draggingDisabled } = useAppSelector(
    (state) => state.window
  );
  const dispatch = useAppDispatch();

  const location = useLocation();

  const navigate = useNavigate();

  const [isFocused, setIsFocused] = useState(false);

  const { t } = useTranslation("header");

  const isOnGamePage = location.pathname.startsWith("/game");

  const title = useMemo(() => {
    if (isOnGamePage) return headerTitle;

    return t(pathTitle[location.pathname]);
  }, [location.pathname, headerTitle, t]);

  useEffect(() => {
    if (search && location.pathname !== "/search") {
      dispatch(clearSearch());
    }
  }, [location.pathname, search, dispatch]);

  const focusInput = () => {
    setIsFocused(true);
    inputRef.current?.focus();
  };

  const handleBlur = () => {
    setIsFocused(false);
  };

  return (
    <header
      className={styles.header({
        draggingDisabled,
        isWindows: window.electron.platform === "win32",
      })}
    >
      <div className={styles.headerTitle}>
        {isOnGamePage && (
          <button className={styles.backButton} onClick={() => navigate(-1)}>
            <ArrowLeftIcon />
          </button>
        )}
        <h3>{title}</h3>
      </div>

      <section className={styles.leftContent}>
        <div className={styles.search({ focused: isFocused })}>
          <button
            type="button"
            className={styles.actionButton}
            onClick={focusInput}
          >
            <SearchIcon />
          </button>

          <input
            ref={inputRef}
            type="text"
            name="search"
            placeholder={t("search")}
            value={search}
            className={styles.searchInput}
            onChange={(event) => onSearch(event.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={handleBlur}
          />

          {search && (
            <button
              type="button"
              onClick={onClear}
              className={styles.actionButton}
            >
              <XIcon />
            </button>
          )}
        </div>
      </section>
    </header>
  );
}
