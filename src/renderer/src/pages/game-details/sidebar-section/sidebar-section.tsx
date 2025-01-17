import { ChevronDownIcon } from "@primer/octicons-react";
import { useRef, useState } from "react";

import * as styles from "./sidebar-section.css";

export interface SidebarSectionProps {
  title: string;
  children: React.ReactNode;
}

export function SidebarSection({ title, children }: SidebarSectionProps) {
  const content = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(true);

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
          transition: "max-height 0.4s cubic-bezier(0, 1, 0, 1)",
          position: "relative",
        }}
      >
        {children}
      </div>
    </div>
  );
}
