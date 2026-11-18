import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircleFillIcon,
  AlertIcon,
  LinkExternalIcon,
} from "@primer/octicons-react";
import type { MacCompatibilityStatus } from "@types";
import { Link } from "../link/link";
import "./macos-compatibility-notice.scss";

export const NOTPROTON_REQUIRED_ERROR_CODE = "notproton-crossover-required";

export const isNotProtonRequiredError = (error: unknown): boolean => {
  if (error instanceof Error) {
    return error.message.includes(NOTPROTON_REQUIRED_ERROR_CODE);
  }
  return String(error).includes(NOTPROTON_REQUIRED_ERROR_CODE);
};

export interface MacOsCompatibilityNoticeProps {
  status?: MacCompatibilityStatus | null;
}

export function MacOsCompatibilityNotice({
  status: externalStatus,
}: Readonly<MacOsCompatibilityNoticeProps>) {
  const { t } = useTranslation("settings");
  const [internalStatus, setInternalStatus] =
    useState<MacCompatibilityStatus | null>(null);

  useEffect(() => {
    if (externalStatus !== undefined || window.electron.platform !== "darwin") {
      return;
    }

    window.electron
      .getMacCompatibilityStatus()
      .then(setInternalStatus)
      .catch(() => setInternalStatus(null));
  }, [externalStatus]);

  if (window.electron.platform !== "darwin") {
    return null;
  }

  const status = externalStatus ?? internalStatus;

  return (
    <div
      className={`macos-compatibility-notice ${
        status && !status.isReady ? "macos-compatibility-notice--warning" : ""
      }`}
    >
      <div className="macos-compatibility-notice__header">
        <AlertIcon size={16} />
        <strong>
          {t("macos_notproton_required_title", {
            defaultValue:
              "Windows (.exe) games on macOS require NotProton + CrossOver",
          })}
        </strong>
      </div>

      <p className="macos-compatibility-notice__description">
        {t("macos_notproton_required_description", {
          defaultValue:
            "Library repositories contain Windows games. To run them on macOS (or launch them via Add to Steam), you must have both CrossOver and NotProton installed.",
        })}
      </p>

      {status && (
        <div className="macos-compatibility-notice__checks">
          <div className="macos-compatibility-notice__check-item">
            <span
              className={`macos-compatibility-notice__badge ${
                status.hasCrossOver
                  ? "macos-compatibility-notice__badge--ok"
                  : "macos-compatibility-notice__badge--missing"
              }`}
            >
              {status.hasCrossOver ? (
                <CheckCircleFillIcon size={12} />
              ) : (
                <AlertIcon size={12} />
              )}
              <span>
                CrossOver:{" "}
                {status.hasCrossOver
                  ? t("macos_status_installed", { defaultValue: "Detected" })
                  : t("macos_status_missing", { defaultValue: "Missing" })}
              </span>
            </span>
            {!status.hasCrossOver && (
              <Link to="https://www.codeweavers.com/products/crossover">
                CrossOver <LinkExternalIcon size={12} />
              </Link>
            )}
          </div>

          <div className="macos-compatibility-notice__check-item">
            <span
              className={`macos-compatibility-notice__badge ${
                status.notProtonTools.length > 0
                  ? "macos-compatibility-notice__badge--ok"
                  : "macos-compatibility-notice__badge--missing"
              }`}
            >
              {status.notProtonTools.length > 0 ? (
                <CheckCircleFillIcon size={12} />
              ) : (
                <AlertIcon size={12} />
              )}
              <span>
                NotProton:{" "}
                {status.notProtonTools.length > 0
                  ? status.notProtonTools.map((tool) => tool.name).join(", ")
                  : t("macos_status_missing", { defaultValue: "Missing" })}
              </span>
            </span>
            {status.notProtonTools.length === 0 && (
              <Link to="https://github.com/NotProtonNot/NotProton">
                NotProton <LinkExternalIcon size={12} />
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
