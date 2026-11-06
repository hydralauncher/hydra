import "./styles.scss";

import { type ReactNode, useRef, useEffect } from "react";
import cn from "classnames";

export interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
  viewportRef?: React.RefObject<HTMLDivElement>;
  onScroll?: (info: {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  }) => void;
  showScrollbar?: boolean;
}

export function ScrollArea({
  children,
  className,
  viewportRef,
  onScroll,
  showScrollbar = false,
}: Readonly<ScrollAreaProps>) {
  const localRef = useRef<HTMLDivElement>(null);
  const ref = viewportRef ?? localRef;

  useEffect(() => {
    if (!onScroll) return;

    const el = ref.current;
    if (!el) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      onScroll({ scrollTop, scrollHeight, clientHeight });
    };

    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [onScroll, ref]);

  return (
    <div
      ref={ref}
      className={cn(
        "scroll-area",
        className,
        !showScrollbar && "scroll-area--hide-scrollbar"
      )}
    >
      {children}
    </div>
  );
}
