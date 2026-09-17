import cn from "classnames";
import { AlertIcon, CheckCircleFillIcon } from "@primer/octicons-react";
import type { ReactNode } from "react";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

import "./settings-integration-card.scss";

type IntegrationStatusTone = "neutral" | "success" | "warning";

interface SettingsIntegrationCardProps {
  title: string;
  logo: ReactNode;
  status: string;
  statusTone?: IntegrationStatusTone;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  loading?: boolean;
}

export function SettingsIntegrationCard({
  title,
  logo,
  status,
  statusTone = "neutral",
  actions,
  children,
  className,
  loading = false,
}: Readonly<SettingsIntegrationCardProps>) {
  return (
    <section
      className={cn("settings-integration-card", className)}
      aria-busy={loading}
    >
      <header className="settings-integration-card__header">
        <div className="settings-integration-card__heading">
          <span className="settings-integration-card__logo">{logo}</span>
          <h3 className="settings-integration-card__title">{title}</h3>
          {loading ? (
            <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
              <Skeleton width={96} height={14} />
            </SkeletonTheme>
          ) : (
            <span
              className={cn(
                "settings-integration-card__status",
                `settings-integration-card__status--${statusTone}`
              )}
            >
              {statusTone === "success" ? (
                <CheckCircleFillIcon size={14} />
              ) : statusTone === "warning" ? (
                <AlertIcon size={14} />
              ) : (
                <span className="settings-integration-card__status-dot" />
              )}
              {status}
            </span>
          )}
        </div>

        {loading ? (
          <div className="settings-integration-card__actions">
            <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
              <Skeleton width={104} height={40} borderRadius={8} />
            </SkeletonTheme>
          </div>
        ) : actions ? (
          <div className="settings-integration-card__actions">{actions}</div>
        ) : null}
      </header>

      <div className="settings-integration-card__content">
        {loading ? (
          <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
            <div className="settings-integration-card__loading-content">
              <Skeleton width={40} height={40} borderRadius={6} />
              <div className="settings-integration-card__loading-copy">
                <Skeleton width={156} height={14} />
                <Skeleton width={112} height={12} />
              </div>
            </div>
          </SkeletonTheme>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
