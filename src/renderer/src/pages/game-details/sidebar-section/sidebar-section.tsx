import { ChevronDownIcon } from "@primer/octicons-react";
import { useEffect, useRef, useState } from "react";

import * as styles from "./sidebar-section.css";

export interface SidebarSectionProps {
  title: string;
  children: React.ReactNode;
}

export function SidebarSection({ title, children }: SidebarSectionProps) {
  const content = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(true);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (content.current && content.current.scrollHeight !== height) {
      setHeight(isOpen ? content.current.scrollHeight : 0);
    } else if (!isOpen) {
      setHeight(0);
    }
  }, [isOpen, children, height]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={styles.sidebarSectionButton}
      >
        <ChevronDownIcon className={styles.chevron({ open: isOpen })} />
        <span>{title}</span>
      </button>

      <div
        ref={content}
        style={{
          maxHeight: `${height}px`,
          overflow: "hidden",
          transition: "max-height 0.4s cubic-bezier(0, 1, 0, 1)",
          position: "relative",
        }}
      >
        {children}
      </div>
    </div>
  );
}
