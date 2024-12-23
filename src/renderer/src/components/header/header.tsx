import { useTranslation } from "react-i18next";
import { useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeftIcon, SearchIcon, XIcon } from "@primer/octicons-react";

import { useAppDispatch, useAppSelector } from "@renderer/hooks";

import * as styles from "./header.css";
import { AutoUpdateSubHeader } from "./auto-update-sub-header";
import { setSearch } from "@renderer/features";

const pathTitle: Record<string, string> = {
  "/": "home",
  "/catalogue": "catalogue",
  "/downloads": "downloads",
  "/settings": "settings",
};

export function Header() {
  const inputRef = useRef<HTMLInputElement>(null);

  const navigate = useNavigate();
  const location = useLocation();

  const { headerTitle, draggingDisabled } = useAppSelector(
    (state) => state.window
  );

  const searchValue = useAppSelector(
    (state) => state.catalogueSearch.value.title
  );

  const dispatch = useAppDispatch();

  const [isFocused, setIsFocused] = useState(false);

  const { t } = useTranslation("header");

  const title = useMemo(() => {
    if (location.pathname.startsWith("/game")) return headerTitle;
    if (location.pathname.startsWith("/achievements")) return headerTitle;
    if (location.pathname.startsWith("/profile")) return headerTitle;
    if (location.pathname.startsWith("/search")) return t("search_results");

    return t(pathTitle[location.pathname]);
  }, [location.pathname, headerTitle, t]);

  const focusInput = () => {
    setIsFocused(true);
    inputRef.current?.focus();
  };

  const handleBlur = () => {
    setIsFocused(false);
  };

  const handleBackButtonClick = () => {
    navigate(-1);
  };

  const handleSearch = (value: string) => {
    dispatch(setSearch({ title: value }));

    if (!location.pathname.startsWith("/catalogue")) {
      navigate("/catalogue");
    }
  };

  return (
    <>
      <header
        className={styles.header({
          draggingDisabled,
          isWindows: window.electron.platform === "win32",
        })}
      >
        <section className={styles.section} style={{ flex: 1 }}>
          <button
            type="button"
            className={styles.backButton({
              enabled: location.key !== "default",
            })}
            onClick={handleBackButtonClick}
            disabled={location.key === "default"}
          >
            <ArrowLeftIcon />
          </button>

          <h3
            className={styles.title({
              hasBackButton: location.key !== "default",
            })}
          >
            {title}
          </h3>
        </section>

        <section className={styles.section}>
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
              value={searchValue}
              className={styles.searchInput}
              onChange={(event) => handleSearch(event.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={handleBlur}
            />

            {searchValue && (
              <button
                type="button"
                onClick={() => dispatch(setSearch({ title: "" }))}
                className={styles.actionButton}
              >
                <XIcon />
              </button>
            )}
          </div>
        </section>
      </header>
      <AutoUpdateSubHeader />
    </>
  );
}
