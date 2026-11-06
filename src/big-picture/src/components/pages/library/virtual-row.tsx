import type { CSSProperties, ReactNode, Ref } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";

interface LibraryVirtualRowProps {
  virtualRow: VirtualItem;
  scrollMargin: number;
  measureElement: Ref<HTMLDivElement>;
  className: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function LibraryVirtualRow({
  virtualRow,
  scrollMargin,
  measureElement,
  className,
  style,
  children,
}: Readonly<LibraryVirtualRowProps>) {
  return (
    <div
      ref={measureElement}
      data-index={virtualRow.index}
      className={className}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        transform: `translateY(${virtualRow.start - scrollMargin}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
