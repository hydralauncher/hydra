import "./styles.scss";

import { XIcon } from "@phosphor-icons/react";
import cn from "classnames";
import type { HTMLAttributes, ReactNode } from "react";
import { Typography } from "..";

export interface EmptyStateProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  illustration?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function EmptyState({
  illustration,
  icon,
  title,
  description,
  actions,
  className,
  ...props
}: Readonly<EmptyStateProps>) {
  const resolvedIcon = icon ?? <XIcon size={32} weight="bold" />;
  const hasIllustration = Boolean(illustration);

  return (
    <div
      className={cn("empty-state", className, {
        "empty-state--with-illustration": hasIllustration,
      })}
      {...props}
    >
      <div className="empty-state__content">
        <div className="empty-state__visual" aria-hidden="true">
          <div className="empty-state__pattern" />

          {illustration ? (
            <div className="empty-state__illustration">{illustration}</div>
          ) : null}

          <div className="empty-state__icon">
            <div className="empty-state__icon-content">{resolvedIcon}</div>
          </div>
        </div>

        <div className="empty-state__copy">
          <Typography variant="h2" className="empty-state__title">
            {title}
          </Typography>

          {description ? (
            <Typography className="empty-state__description">
              {description}
            </Typography>
          ) : null}
        </div>
      </div>

      {actions ? <div className="empty-state__actions">{actions}</div> : null}
    </div>
  );
}
