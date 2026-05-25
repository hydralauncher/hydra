import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { IS_DESKTOP } from "../../../constants";
import { useNavigationHistoryStore } from "../../../stores";

const basePath = IS_DESKTOP ? "/big-picture" : "";

const capitalize = (word: string) =>
  word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

export function getDefaultPageTitle(pathname: string): string {
  const relative = basePath ? pathname.replace(basePath, "") : pathname;
  const segments = relative.split("/").filter(Boolean);

  if (segments.length === 0) return "Home";

  if (segments[0] === "game") {
    if (segments[3] === "achievements") return "Achievements";
    return "Game Details";
  }

  return capitalize(segments[0]);
}

export function NavigationHistoryBridge() {
  const location = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    const store = useNavigationHistoryStore.getState();
    const entry = {
      key: location.key,
      pathname: location.pathname,
      title: getDefaultPageTitle(location.pathname),
    };

    const top = store.stack[store.stack.length - 1];
    if (top && top.key === entry.key) return;

    if (store.stack.length === 0) {
      store.push(entry);
      return;
    }

    if (navigationType === "POP") {
      const idx = store.stack.findIndex((e) => e.key === entry.key);
      if (idx >= 0) {
        const popCount = store.stack.length - 1 - idx;
        for (let i = 0; i < popCount; i++) store.pop();
      } else {
        store.replaceTop(entry);
      }
      return;
    }

    if (navigationType === "REPLACE") {
      store.replaceTop(entry);
      return;
    }

    store.push(entry);
  }, [location.key, location.pathname, navigationType]);

  return null;
}
