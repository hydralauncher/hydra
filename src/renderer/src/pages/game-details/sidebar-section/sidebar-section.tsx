import { ChevronDownIcon } from "@primer/octicons-react";
import { LinkExternalIcon } from "@primer/octicons-react";
import { useEffect, useRef, useState } from "react";
import "./sidebar-section.scss";

export interface SidebarSectionProps {
  title: string;
  subtitle?: string;
  subtitleHref?: string;
  children: React.ReactNode;
}

export function SidebarSection({
  title,
  subtitle,
  subtitleHref,
  children,
}: SidebarSectionProps) {
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
      <div className="sidebar-section__header">
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

        {subtitle && subtitleHref && (
          <a
            href={subtitleHref}
            className="sidebar-section__subtitle"
            target="_blank"
            rel="noreferrer"
          >
            {subtitle}
            <LinkExternalIcon size={12} />
          </a>
        )}
      </div>

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
