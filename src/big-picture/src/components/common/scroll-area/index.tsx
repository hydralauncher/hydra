import { ReactNode, useRef, useEffect } from "react";
import clsx from "clsx";

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

export function ScrollArea({
  children,
  className,
  onScroll,
  showScrollbar = false,
}: Readonly<ScrollAreaProps>) {
  const ref = useRef<HTMLDivElement>(null);

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
      className={clsx(
        "scroll-area",
        className,
        !showScrollbar && "scroll-area--hide-scrollbar"
      )}
    >
      {children}
    </div>
  );
}
