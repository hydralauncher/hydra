import { useCallback, useEffect, useRef, useState } from "react";

const VISIBILITY_ROOT_MARGIN = "400px 0px";

export const useVisibleFriendIds = () => {
  const [visibleFriendIds, setVisibleFriendIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const observerRef = useRef<IntersectionObserver | null>(null);
  const observedElementsRef = useRef(new Map<string, Element>());

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const newlyVisible = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => (entry.target as HTMLElement).dataset.friendId)
          .filter((friendId): friendId is string => Boolean(friendId));
        if (newlyVisible.length === 0) return;

        setVisibleFriendIds((current) => {
          if (newlyVisible.every((friendId) => current.has(friendId))) {
            return current;
          }
          return new Set([...current, ...newlyVisible]);
        });
      },
      { rootMargin: VISIBILITY_ROOT_MARGIN }
    );

    observerRef.current = observer;
    for (const element of observedElementsRef.current.values()) {
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, []);

  const refCallbacksRef = useRef(
    new Map<string, (element: HTMLElement | null) => void>()
  );

  const observeFriendElement = useCallback((friendId: string) => {
    const cached = refCallbacksRef.current.get(friendId);
    if (cached) return cached;

    const refCallback = (element: HTMLElement | null) => {
      const observed = observedElementsRef.current;
      const previous = observed.get(friendId);
      if (previous === element) return;

      if (previous) {
        observerRef.current?.unobserve(previous);
        observed.delete(friendId);
      }
      if (element) {
        observed.set(friendId, element);
        observerRef.current?.observe(element);
      }
    };

    refCallbacksRef.current.set(friendId, refCallback);
    return refCallback;
  }, []);

  const isObservationSupported = typeof IntersectionObserver !== "undefined";

  return { visibleFriendIds, observeFriendElement, isObservationSupported };
};
