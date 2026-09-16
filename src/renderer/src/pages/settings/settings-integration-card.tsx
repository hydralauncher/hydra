import cn from "classnames";
import { AlertIcon, CheckCircleFillIcon } from "@primer/octicons-react";
import type { ReactNode } from "react";

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
}

export function SettingsIntegrationCard({
  title,
  logo,
  status,
  statusTone = "neutral",
  actions,
  children,
  className,
}: Readonly<SettingsIntegrationCardProps>) {
  return (
    <section className={cn("settings-integration-card", className)}>
      <header className="settings-integration-card__header">
        <div className="settings-integration-card__heading">
          <span className="settings-integration-card__logo">{logo}</span>
          <h3 className="settings-integration-card__title">{title}</h3>
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
        </div>

        {actions ? (
          <div className="settings-integration-card__actions">{actions}</div>
        ) : null}
      </header>

      {children ? (
        <div className="settings-integration-card__content">{children}</div>
      ) : null}
    </section>
  );
}
