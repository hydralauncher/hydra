import { ReactNode } from "react";
import "./downloads-section.scss";

interface DownloadsSectionProps {
  title: string;
  count: number;
  subtext?: string;
  emptyText?: string;
  children?: ReactNode;
}

export function DownloadsSection({
  title,
  count,
  subtext,
  emptyText,
  children,
}: Readonly<DownloadsSectionProps>) {
  return (
    <section className="downloads-section">
      <div className="downloads-section__header">
        <div className="downloads-section__title-group">
          <h2 className="downloads-section__title">
            {title} <span className="downloads-section__count">({count})</span>
          </h2>
          <div className="downloads-section__line" />
        </div>
        {subtext && (
          <span className="downloads-section__subtext">{subtext}</span>
        )}
      </div>

      {count > 0 ? (
        <div className="downloads-section__list">{children}</div>
      ) : (
        emptyText && <div className="downloads-section__empty">{emptyText}</div>
      )}
    </section>
  );
}
