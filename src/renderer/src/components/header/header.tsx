import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeftIcon, SearchIcon, XIcon } from "@primer/octicons-react";

import { useAppDispatch, useAppSelector } from "@renderer/hooks";

import "./header.scss";
import { AutoUpdateSubHeader } from "./auto-update-sub-header";
import { setFilters } from "@renderer/features";
import cn from "classnames";

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
    (state) => state.catalogueSearch.filters.title
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
    dispatch(setFilters({ title: value }));

    if (!location.pathname.startsWith("/catalogue")) {
      navigate("/catalogue");
    }
  };

  useEffect(() => {
    if (!location.pathname.startsWith("/catalogue") && searchValue) {
      dispatch(setFilters({ title: "" }));
    }
  }, [location.pathname, searchValue, dispatch]);

  return (
    <>
      <header
        className={cn("header", {
          "header--dragging-disabled": draggingDisabled,
          "header--is-windows": window.electron.platform === "win32",
        })}
      >
        <section className="header__section header__section--left">
          <button
            type="button"
            className={cn("header__back-button", {
              "header__back-button--enabled": location.key !== "default",
            })}
            onClick={handleBackButtonClick}
            disabled={location.key === "default"}
          >
            <ArrowLeftIcon />
          </button>

          <h3
            className={cn("header__title", {
              "header__title--has-back-button": location.key !== "default",
            })}
          >
            {title}
          </h3>
        </section>

        <section className="header__section">
          <div
            className={cn("header__search", {
              "header__search--focused": isFocused,
            })}
          >
            <button
              type="button"
              className="header__action-button"
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
              className="header__search-input"
              onChange={(event) => handleSearch(event.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={handleBlur}
            />

            {searchValue && (
              <button
                type="button"
                onClick={() => dispatch(setFilters({ title: "" }))}
                className="header__action-button"
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
