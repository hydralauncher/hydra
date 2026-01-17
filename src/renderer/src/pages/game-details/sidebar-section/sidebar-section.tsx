import { ChevronDownIcon } from "@primer/octicons-react";
import { useEffect, useRef, useState } from "react";
import "./sidebar-section.scss";

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
    <div className="sidebar-section">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="sidebar-section__button"
      >
        <ChevronDownIcon
          className={`sidebar-section__chevron ${
            isOpen ? "sidebar-section__chevron--open" : ""
          }`}
        />
        <span>{title}</span>
      </button>

      <div
        ref={content}
        className="sidebar-section__content"
        style={{
          maxHeight: `${height}px`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
