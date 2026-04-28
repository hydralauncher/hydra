import { ArrowLeftIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";

import cn from "classnames";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { FocusItem, HorizontalFocusGroup, Typography } from "../../components";
import { IS_DESKTOP } from "../../constants";
import type { FocusOverrides } from "../../services";
import "./styles.scss";

const basePath = IS_DESKTOP ? "/big-picture" : "";

const capitalize = (word: string) =>
  word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

const HEADER_BACK_BUTTON_ID = "header-back-button";
const HEADER_SEARCH_INPUT_ID = "header-search-input";

const usePageTitle = () => {
  const { pathname } = useLocation();
  const { slug } = useParams<{ slug: string }>();

  if (pathname.startsWith("/game/")) {
    return slug ? slug.split("-").map(capitalize).join(" ") : "Game Details";
  }

  const relativePath = basePath ? pathname.replace(basePath, "") : pathname;
  const firstSegment = relativePath.split("/")[1];
  return firstSegment ? capitalize(firstSegment) : "Home";
};

function Header() {
  const navigate = useNavigate();
  const pageTitle = usePageTitle();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLButtonElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const searchNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: HEADER_BACK_BUTTON_ID,
    },
  };

  const handleSearchToggle = () => {
    setIsSearchOpen((open) => {
      if (open) {
        inputRef.current?.blur();
        return false;
      }
      return true;
    });
  };

  useEffect(() => {
    if (isSearchOpen) {
      inputRef.current?.focus();
    }
  }, [isSearchOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!searchRef.current?.contains(e.target as Node)) {
        setIsSearchOpen(false);
        inputRef.current?.blur();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isSearchOpen) {
        setIsSearchOpen(false);
        inputRef.current?.blur();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isSearchOpen]);

  return (
    <div className="header">
      <HorizontalFocusGroup regionId="header" asChild>
        <header className="header__container">
          <FocusItem id={HEADER_BACK_BUTTON_ID} asChild>
            <button className="header__action" onClick={() => navigate(-1)}>
              <ArrowLeftIcon size={24} weight="bold" />
              <Typography variant="label" className="header__title">
                {pageTitle}
              </Typography>
            </button>
          </FocusItem>

          <FocusItem
            id={HEADER_SEARCH_INPUT_ID}
            navigationOverrides={searchNavigationOverrides}
            asChild
          >
            <button
              ref={searchRef}
              className={cn("header__search", {
                "header__search--open": isSearchOpen,
              })}
              onClick={handleSearchToggle}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
            >
              <AnimatePresence>
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

              <input
                ref={inputRef}
                type="text"
                className="header__search-input typography typography--body"
                spellCheck={false}
                placeholder="Looking for anything in particular?"
              />
            </button>
          </FocusItem>
        </header>
      </HorizontalFocusGroup>
    </div>
  );
}

export { Header };
