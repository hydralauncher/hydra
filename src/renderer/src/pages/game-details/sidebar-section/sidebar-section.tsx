import { ChevronDownIcon, LinkExternalIcon } from "@primer/octicons-react";
import { useState } from "react";
import cn from "classnames";
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
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="sidebar-section">
      <div className="sidebar-section__header">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="sidebar-section__toggle"
          aria-expanded={isOpen}
          aria-label={title}
        />

        <span className="sidebar-section__button">
          <ChevronDownIcon
            className={`sidebar-section__chevron ${
              isOpen ? "sidebar-section__chevron--open" : ""
            }`}
          />
          <span>{title}</span>
        </span>

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

      {/* Collapses with a grid-row transition instead of a measured
          max-height, so the section renders at its full height on the first
          paint and never grows into place. */}
      <div
        className={cn("sidebar-section__content", {
          "sidebar-section__content--closed": !isOpen,
        })}
        aria-hidden={!isOpen}
      >
        <div className="sidebar-section__body">{children}</div>
      </div>
    </div>
  );
}
