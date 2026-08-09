import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { LinkExternalIcon, SyncIcon } from "@primer/octicons-react";

export interface InstallProgressLike {
  phase: string;
  loaded?: number;
  total?: number;
}

export const installPercent = (loaded?: number, total?: number): number =>
  total && total > 0 ? Math.floor(((loaded ?? 0) / total) * 100) : 0;

export const installStatusText = (
  t: TFunction<"settings">,
  name: string,
  current: InstallProgressLike | undefined
): string => {
  if (!current) return t("setup_install_with_hydra_desc", { name });
  if (current.phase === "downloading") {
    return t("setup_install_downloading", {
      percent: installPercent(current.loaded, current.total),
    });
  }
  if (current.phase === "extracting") return t("setup_install_extracting");
  if (current.phase === "running") return t("setup_install_running");
  if (current.phase === "done") return t("setup_install_done");
  if (current.phase === "error") return t("setup_install_failed");
  return t("setup_install_with_hydra_desc", { name });
};

export function InstallProgressBar({
  progress,
}: Readonly<{ progress: InstallProgressLike | undefined }>) {
  if (!progress) return null;
  if (progress.phase === "done" || progress.phase === "error") return null;

  const hasTotal = Boolean(progress.total && progress.total > 0);
  const indeterminate = progress.phase !== "downloading" || !hasTotal;
  const percent = hasTotal
    ? Math.min(100, installPercent(progress.loaded, progress.total))
    : 0;

  return (
    <div className="setup-modal__progress-bar" style={{ marginTop: 10 }}>
      <div
        className={`setup-modal__progress-fill ${
          indeterminate ? "setup-modal__progress-fill--indeterminate" : ""
        }`}
        style={indeterminate ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}

export function InstallLoadingCard() {
  const { t } = useTranslation("settings");

  return (
    <div className="setup-modal__download-card setup-modal__download-card--loading">
      <div className="setup-modal__download-card-badge">
        <SyncIcon size={20} className="setup-modal__spin" />
      </div>
      <div className="setup-modal__download-card-main">
        <span className="setup-modal__download-card-title">
          {t("setup_install_loading")}
        </span>
      </div>
    </div>
  );
}

interface ExternalLinkCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  url: string | null;
  onOpen: (url: string) => void;
}

export function ExternalLinkCard({
  icon,
  title,
  description,
  url,
  onOpen,
}: Readonly<ExternalLinkCardProps>) {
  return (
    <button
      type="button"
      className="setup-modal__download-card"
      onClick={() => url && onOpen(url)}
    >
      <div className="setup-modal__download-card-badge">{icon}</div>
      <div className="setup-modal__download-card-main">
        <span className="setup-modal__download-card-title">{title}</span>
        <span className="setup-modal__download-card-desc">{description}</span>
      </div>
      <span className="setup-modal__download-card-footer">
        <span className="setup-modal__download-card-url">{url}</span>
        <LinkExternalIcon
          size={14}
          className="setup-modal__download-card-ext"
        />
      </span>
    </button>
  );
}
