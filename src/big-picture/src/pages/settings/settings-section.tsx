import type { ReactNode } from "react";

import "./settings-section.scss";

interface SettingsSectionProps {
  title: ReactNode;
  description: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function SettingsSection({
  title,
  description,
  children,
  className,
}: Readonly<SettingsSectionProps>) {
  return (
    <section
      className={
        className ? `settings-section ${className}` : "settings-section"
      }
    >
      <div className="settings-section__header">
        <p className="settings-section__title">{title}</p>
        <p className="settings-section__description">{description}</p>
      </div>

      {children ? (
        <div className="settings-section__content">{children}</div>
      ) : null}
    </section>
  );
}
