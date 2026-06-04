import { ArrowLeftIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";

import cn from "classnames";
import { AnimatePresence, motion } from "framer-motion";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { FocusItem, HorizontalFocusGroup, Typography } from "../../components";
import { IS_DESKTOP } from "../../constants";
import { useNavigationScreenActions } from "../../hooks";
import type { FocusOverrides } from "../../services";
import {
  useNavigationHistoryStore,
  useNavigationStore,
  useVirtualKeyboardStore,
} from "../../stores";
import {
  BIG_PICTURE_HEADER_REGION_ID,
  normalizeBigPicturePathname,
} from "../navigation";
import "./styles.scss";

const HEADER_BACK_BUTTON_ID = "header-back-button";
const HEADER_SEARCH_INPUT_ID = "header-search-input";
const MAX_SEARCH_LENGTH = 255;
const VIRTUAL_KEYBOARD_DISMISS_EVENT = "big-picture-virtual-keyboard-dismiss";
const VIRTUAL_KEYBOARD_KEY_FOCUS_ID_PREFIX =
  "big-picture-virtual-keyboard-key-";

const useCurrentPageTitle = () => {
  const stack = useNavigationHistoryStore((s) => s.stack);
  if (stack.length >= 1) return stack[stack.length - 1].title;
  return "Home";
};

function Header() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const pageTitle = useCurrentPageTitle();
  const isOnCataloguePage =
    normalizeBigPicturePathname(pathname) === "/catalogue";
  const catalogueSearchValue = searchParams.get("title") ?? "";
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState(() =>
    isOnCataloguePage ? catalogueSearchValue : ""
  );
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const virtualKeyboardTarget = useVirtualKeyboardStore(
    (state) => state.target
  );
  const closeVirtualKeyboard = useVirtualKeyboardStore(
    (state) => state.closeKeyboard
  );
  const isSearchFocused = currentFocusId === HEADER_SEARCH_INPUT_ID;
  const canAutoOpenSearchRef = useRef(
    currentFocusId !== null && currentFocusId !== HEADER_SEARCH_INPUT_ID
  );
  const isSearchDismissedWhileFocusedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLFormElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const searchNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: HEADER_BACK_BUTTON_ID,
    },
  };
  const isSearchVirtualKeyboardTarget =
    virtualKeyboardTarget !== null &&
    virtualKeyboardTarget === inputRef.current;

  const openSearch = useCallback(() => {
    isSearchDismissedWhileFocusedRef.current = false;
    setIsSearchOpen(true);
    inputRef.current?.focus();
  }, []);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    inputRef.current?.blur();
  }, []);

  const dismissSearch = useCallback(
    ({ closeKeyboard = false }: { closeKeyboard?: boolean } = {}) => {
      if (closeKeyboard && isSearchVirtualKeyboardTarget) {
        closeVirtualKeyboard?.({ restoreFocus: false });
      }

      isSearchDismissedWhileFocusedRef.current = true;
      closeSearch();
    },
    [closeSearch, closeVirtualKeyboard, isSearchVirtualKeyboardTarget]
  );

  const closeSearchKeepingFocus = useCallback(() => {
    dismissSearch({ closeKeyboard: true });

    globalThis.window.requestAnimationFrame(() => {
      searchTriggerRef.current?.focus({ preventScroll: true });
    });
  }, [dismissSearch]);

  const updateCatalogueTitle = useCallback(
    (value: string) => {
      setSearchParams(
        (currentSearchParams) => {
          const nextSearchParams = new URLSearchParams(currentSearchParams);

          if (value.trim()) {
            nextSearchParams.set("title", value);
          } else {
            nextSearchParams.delete("title");
          }

          return nextSearchParams;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const handleSearchChange = (value: string) => {
    const nextValue = value.slice(0, MAX_SEARCH_LENGTH);

    setSearchValue(nextValue);

    if (isOnCataloguePage) {
      updateCatalogueTitle(nextValue);
      return;
    }

    if (nextValue.trim()) {
      const nextSearchParams = new URLSearchParams({ title: nextValue });
      const basePath = IS_DESKTOP ? "/big-picture" : "";

      navigate(`${basePath}/catalogue?${nextSearchParams.toString()}`);
    }
  };

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isOnCataloguePage) {
      dismissSearch();
      return;
    }

    if (!searchValue.trim()) {
      return;
    }

    const nextSearchParams = new URLSearchParams({ title: searchValue });
    const basePath = IS_DESKTOP ? "/big-picture" : "";

    dismissSearch();
    navigate(`${basePath}/catalogue?${nextSearchParams.toString()}`);
  };

  useEffect(() => {
    if (isSearchOpen) {
      inputRef.current?.focus();
    }
  }, [isSearchOpen]);

  useEffect(() => {
    if (!isSearchFocused && !isSearchVirtualKeyboardTarget) {
      if (currentFocusId !== null) {
        canAutoOpenSearchRef.current = true;
      }

      const isFocusStillInsideVirtualKeyboard =
        currentFocusId?.startsWith(VIRTUAL_KEYBOARD_KEY_FOCUS_ID_PREFIX) ??
        false;

      if (currentFocusId !== null && !isFocusStillInsideVirtualKeyboard) {
        isSearchDismissedWhileFocusedRef.current = false;
      }

      if (isSearchOpen) {
        setIsSearchOpen(false);
        inputRef.current?.blur();
      }

      return;
    }

    if (isSearchVirtualKeyboardTarget) {
      return;
    }

    if (
      canAutoOpenSearchRef.current &&
      !isSearchOpen &&
      !isSearchDismissedWhileFocusedRef.current
    ) {
      openSearch();
    }
  }, [
    currentFocusId,
    isSearchFocused,
    isSearchOpen,
    isSearchVirtualKeyboardTarget,
    openSearch,
  ]);

  useEffect(() => {
    if (isOnCataloguePage) {
      setSearchValue(catalogueSearchValue);
    }
  }, [catalogueSearchValue, isOnCataloguePage]);

  useEffect(() => {
    const handleVirtualKeyboardDismiss = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      if (event.detail?.target !== inputRef.current) return;

      isSearchDismissedWhileFocusedRef.current = true;
      closeSearch();
    };

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const isVirtualKeyboardClick = Boolean(
        target?.closest(".virtual-keyboard")
      );

      if (isVirtualKeyboardClick && isSearchVirtualKeyboardTarget) {
        return;
      }

      if (isSearchOpen && !searchRef.current?.contains(e.target as Node)) {
        dismissSearch({ closeKeyboard: true });
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isSearchOpen) {
        closeSearchKeepingFocus();
      }
    };

    globalThis.window.addEventListener(
      VIRTUAL_KEYBOARD_DISMISS_EVENT,
      handleVirtualKeyboardDismiss
    );
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      globalThis.window.removeEventListener(
        VIRTUAL_KEYBOARD_DISMISS_EVENT,
        handleVirtualKeyboardDismiss
      );
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [
    closeSearch,
    closeSearchKeepingFocus,
    dismissSearch,
    isSearchOpen,
    isSearchVirtualKeyboardTarget,
  ]);

  useNavigationScreenActions(
    isSearchOpen
      ? {
          press: {
            b: closeSearchKeepingFocus,
          },
        }
      : {}
  );

  return (
    <div className="header">
      <HorizontalFocusGroup regionId={BIG_PICTURE_HEADER_REGION_ID} asChild>
        <header className="header__container">
          <FocusItem id={HEADER_BACK_BUTTON_ID} asChild>
            <button className="header__action" onClick={() => navigate(-1)}>
              <ArrowLeftIcon size={24} weight="bold" />
              <Typography variant="label" className="header__title">
                {pageTitle}
              </Typography>
            </button>
          </FocusItem>

          <form
            ref={searchRef}
            role="search"
            className={cn("header__search", {
              "header__search--open": isSearchOpen,
            })}
            onSubmit={handleSearchSubmit}
          >
            <AnimatePresence initial={false}>
              {isSearchOpen || isHovered ? (
                <motion.div
                  key="left"
                  initial={{ x: 24, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 24, opacity: 0 }}
                  transition={{
                    duration: 0.2,
                    ease: "easeInOut",
                    delay: 0.1,
                  }}
                  className="header__search-icon header__search-icon--left"
                >
                  <MagnifyingGlassIcon size={24} />
                </motion.div>
              ) : (
                <motion.div
                  key="right"
                  initial={{ x: -24, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -24, opacity: 0 }}
                  transition={{
                    duration: 0.2,
                    ease: "easeInOut",
                    delay: 0.1,
                  }}
                  className="header__search-icon header__search-icon--right"
                >
                  <MagnifyingGlassIcon size={24} />
                </motion.div>
              )}
            </AnimatePresence>

            <FocusItem
              id={HEADER_SEARCH_INPUT_ID}
              actions={{ primary: openSearch }}
              navigationOverrides={searchNavigationOverrides}
              asChild
            >
              <button
                ref={searchTriggerRef}
                type="button"
                aria-label="Search catalogue"
                className="header__search-trigger"
                onClick={openSearch}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
              />
            </FocusItem>

            <input
              ref={inputRef}
              type="text"
              className="header__search-input typography typography--body"
              spellCheck={false}
              autoComplete="off"
              maxLength={MAX_SEARCH_LENGTH}
              tabIndex={isSearchOpen ? 0 : -1}
              placeholder="Looking for anything in particular?"
              value={searchValue}
              onChange={(event) => handleSearchChange(event.target.value)}
            />
          </form>
        </header>
      </HorizontalFocusGroup>
    </div>
  );
}

export { Header };
