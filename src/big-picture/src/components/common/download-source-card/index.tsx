import "./styles.scss";

import { MinusCircleIcon } from "@phosphor-icons/react";

import { Button } from "..";
import type { FocusOverrides } from "../../../services";

interface DownloadSourceCardProps {
  name: string;
  countLabel: string;
  statusLabel: string;
  statusTone?: "default" | "success" | "error";
  url: string;
  removeButtonFocusId?: string;
  removeButtonNavigationOverrides?: FocusOverrides;
  removeDisabled?: boolean;
  onRemove: () => void;
}

export function DownloadSourceCard({
  name,
  countLabel,
  statusLabel,
  statusTone = "default",
  url,
  removeButtonFocusId,
  removeButtonNavigationOverrides,
  removeDisabled = false,
  onRemove,
}: Readonly<DownloadSourceCardProps>) {
  return (
    <article className="download-source-card">
      <div className="download-source-card__header">
        <div className="download-source-card__copy">
          <h3 className="download-source-card__title">{name}</h3>
          <p className="download-source-card__count">{countLabel}</p>
        </div>

        <p
          className={`download-source-card__status download-source-card__status--${statusTone}`}
        >
          {statusLabel}
        </p>
      </div>

      <div className="download-source-card__field-row">
        <div className="download-source-card__field">
          <p className="download-source-card__field-label">
            Download source URL
          </p>

          <div className="download-source-card__field-value">{url}</div>
        </div>

        <Button
          variant="secondary"
          size="small"
          className="download-source-card__remove-button"
          icon={<MinusCircleIcon size={22} weight="bold" />}
          focusId={removeButtonFocusId}
          focusNavigationOverrides={removeButtonNavigationOverrides}
          disabled={removeDisabled}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
    </article>
  );
}
