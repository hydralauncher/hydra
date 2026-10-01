import type { ReactNode } from "react";
import cn from "classnames";
import { CheckCircleFillIcon, AlertIcon } from "@primer/octicons-react";

interface ResourcePath {
  text: string | null;
  placeholder: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}

interface EmulatorResourceRowProps {
  title: string;
  description: string;
  detected: boolean;
  statusLabel: string;
  actions: ReactNode;
  path?: ResourcePath;
  headerAccessory?: ReactNode;
}

export function EmulatorResourceRow({
  title,
  description,
  detected,
  statusLabel,
  actions,
  path,
  headerAccessory,
}: Readonly<EmulatorResourceRowProps>) {
  return (
    <section className="emulator-detail__section">
      <header className="emulator-detail__section-header">
        <div className="emulator-detail__section-text">
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <div className="emulator-detail__res-header-end">
          {headerAccessory}
          <span
            className={cn("emulator-detail__res-status", {
              "emulator-detail__res-status--found": detected,
              "emulator-detail__res-status--warn": !detected,
            })}
          >
            {detected ? (
              <CheckCircleFillIcon size={14} />
            ) : (
              <AlertIcon size={14} />
            )}
            <span>{statusLabel}</span>
          </span>
        </div>
      </header>

      <div
        className={cn("emulator-detail__exec-path-row", {
          "emulator-detail__exec-path-row--actions-only": !path,
        })}
      >
        {path && (
          <button
            type="button"
            className="emulator-detail__exec-path-box"
            onClick={path.onClick}
            disabled={path.disabled}
            title={path.title}
            aria-label={path.title}
          >
            <span
              className={`emulator-detail__exec-path-text${path.text ? "" : " emulator-detail__exec-path-text--placeholder"}`}
              title={path.text ?? undefined}
            >
              {path.text ?? path.placeholder}
            </span>
          </button>
        )}
        <div className="emulator-detail__exec-actions">{actions}</div>
      </div>
    </section>
  );
}
