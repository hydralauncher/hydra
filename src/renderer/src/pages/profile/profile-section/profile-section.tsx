import { ChevronDownIcon } from "@primer/octicons-react";
import { useEffect, useRef, useState } from "react";
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
  const content = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (content.current && content.current.scrollHeight !== height) {
      setHeight(isOpen ? content.current.scrollHeight : 0);
    } else if (!isOpen) {
      setHeight(0);
    }
  }, [isOpen, children, height]);

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

      <div
        ref={content}
        className="profile-section__content"
        style={{
          maxHeight: `${height}px`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
