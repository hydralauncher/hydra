import "./styles.scss";

import { type ReactNode, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import cn from "classnames";

export interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
  onScroll?: (info: {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  }) => void;
  showScrollbar?: boolean;
}

export const ScrollArea = forwardRef<HTMLDivElement, Readonly<ScrollAreaProps>>(
  ({ children, className, onScroll, showScrollbar = false }, forwardedRef) => {
    const ref = useRef<HTMLDivElement>(null);

    useImperativeHandle(forwardedRef, () => ref.current!);

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
  }, [onScroll]);

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
);
