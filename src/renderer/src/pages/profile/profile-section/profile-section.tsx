import { ChevronDownIcon } from "@primer/octicons-react";
import { useState } from "react";
import "./profile-section.scss";

export interface ProfileSectionProps {
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function ProfileSection({
  title,
  count,
  action,
  children,
  defaultOpen = true,
}: ProfileSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="profile-section">
      <div className="profile-section__header">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="profile-section__button"
        >
          <ChevronDownIcon
            className={`profile-section__chevron ${
              isOpen ? "profile-section__chevron--open" : ""
            }`}
          />
          <span>{title}</span>
          {count !== undefined && (
            <span className="profile-section__count">{count}</span>
          )}
        </button>
        {action && <div className="profile-section__action">{action}</div>}
      </div>

      {/* Grid-row collapse instead of a measured max-height: the section
          renders at full height on the first paint instead of growing. */}
      <div
        className={`profile-section__content${isOpen ? "" : " profile-section__content--closed"}`}
        aria-hidden={!isOpen}
      >
        <div className="profile-section__body">{children}</div>
      </div>
    </div>
  );
}
