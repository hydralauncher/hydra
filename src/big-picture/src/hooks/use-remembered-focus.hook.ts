import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { NavigationService } from "../services";

const SCROLL_RESTORE_MAX_FRAMES = 60;

interface RememberedPagePosition {
  focusId: string | null;
  scrollTop: number;
}

const rememberedPositionByPathname = new Map<string, RememberedPagePosition>();

export function getRememberedFocusId(pathname: string) {
  return rememberedPositionByPathname.get(pathname)?.focusId ?? null;
}

export function getRememberedScrollTop(pathname: string) {
  return rememberedPositionByPathname.get(pathname)?.scrollTop ?? 0;
}

function rememberPosition(
  pathname: string,
  update: Partial<RememberedPagePosition>
) {
  rememberedPositionByPathname.set(pathname, {
    focusId: null,
    scrollTop: 0,
    ...rememberedPositionByPathname.get(pathname),
    ...update,
  });
}

export function useRememberedFocus(
  isRememberable: (focusId: string) => boolean,
  scrollElementRef?: RefObject<HTMLElement>
) {
  const { pathname } = useLocation();
  const isRememberableRef = useRef(isRememberable);
  isRememberableRef.current = isRememberable;

  useLayoutEffect(() => {
    const element = scrollElementRef?.current;
    const scrollTop = getRememberedScrollTop(pathname);
    if (!element || scrollTop <= 0) return;

    let frames = 0;
    let animationFrameId = 0;

    const restore = () => {
      element.scrollTop = scrollTop;
      if (
        Math.abs(element.scrollTop - scrollTop) > 1 &&
        frames++ < SCROLL_RESTORE_MAX_FRAMES
      ) {
        animationFrameId = globalThis.requestAnimationFrame(restore);
      }
    };

    restore();

    return () => globalThis.cancelAnimationFrame(animationFrameId);
  }, [pathname, scrollElementRef]);

  useEffect(() => {
    const element = scrollElementRef?.current;
    if (!element) return;

    const handleScroll = () => {
      rememberPosition(pathname, { scrollTop: element.scrollTop });
    };

    element.addEventListener("scroll", handleScroll, { passive: true });
    return () => element.removeEventListener("scroll", handleScroll);
  }, [pathname, scrollElementRef]);

  useEffect(() => {
    const navigation = NavigationService.getInstance();

    return navigation.subscribe(() => {
      const focusId = navigation.getCurrentFocusId();
      if (focusId && isRememberableRef.current(focusId)) {
        rememberPosition(pathname, { focusId });
      }
    });
  }, [pathname]);
}
