import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GlobeIcon,
  LinkExternalIcon,
  SyncIcon,
  DownloadIcon,
} from "@primer/octicons-react";

import type { RetroArchInstallOption, RetroArchInstallProgress } from "@types";

import { RETROARCH_EMULATOR_ICON } from "../../emulator-icons";
import { RETROARCH_LABEL } from "../../retroarch-meta";
import { ArchIcon, FlatpakIcon } from "../brand-icons";

const OFFICIAL_WEBSITE = "https://www.retroarch.com/";

export function SetupStepRetroArchDownload() {
  const { t } = useTranslation("settings");
  const name = RETROARCH_LABEL;

  const [options, setOptions] = useState<RetroArchInstallOption[] | null>(null);
  const [progress, setProgress] = useState<
    Record<string, RetroArchInstallProgress>
  >({});
  const [installingId, setInstallingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    window.electron
      .getRetroArchInstallOptions()
      .then((result) => {
        if (!cancelled) setOptions(result);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.onRetroArchInstallProgress(
      (payload) => {
        setProgress((prev) => ({ ...prev, [payload.optionId]: payload }));
      }
    );
    return unsubscribe;
  }, []);

  const openUrl = (url: string) => {
    window.electron.openExternal(url);
  };

  const handleInstall = async (optionId: string) => {
    if (installingId) return;
    setInstallingId(optionId);
    try {
      await window.electron.installRetroArch(optionId);
    } finally {
      setInstallingId(null);
    }
  };

  const installable = useMemo(
    () => (options ?? []).filter((option) => option.kind !== "link"),
    [options]
  );
  const externalLinks = useMemo(
    () => (options ?? []).filter((option) => option.kind === "link"),
    [options]
  );

  const installStatusText = (optionId: string): string => {
    const current = progress[optionId];
    if (!current) return t("setup_install_with_hydra_desc", { name });
    if (current.phase === "downloading") {
      const percent =
        current.total && current.total > 0
          ? Math.floor(((current.loaded ?? 0) / current.total) * 100)
          : 0;
      return t("setup_install_downloading", { percent });
    }
    if (current.phase === "extracting") return t("setup_install_extracting");
    if (current.phase === "done") return t("setup_install_done");
    if (current.phase === "error") return t("setup_install_failed");
    return t("setup_install_with_hydra_desc", { name });
  };

  const renderProgressBar = (optionId: string) => {
    const current = progress[optionId];
    if (!current) return null;
    if (current.phase === "done" || current.phase === "error") return null;

    const hasTotal = Boolean(current.total && current.total > 0);
    const indeterminate = current.phase !== "downloading" || !hasTotal;
    const percent = hasTotal
      ? Math.min(
          100,
          Math.floor(((current.loaded ?? 0) / current.total!) * 100)
        )
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
  };

  const externalLinkLabel = (option: RetroArchInstallOption): string => {
    if (option.linkKind === "aur") return t("setup_install_aur_note");
    if (option.linkKind === "flatpak") return "Flatpak";
    return t("setup_install_open_releases");
  };

  const externalLinkIcon = (option: RetroArchInstallOption) => {
    if (option.linkKind === "aur") return <ArchIcon size={20} />;
    if (option.linkKind === "flatpak") return <FlatpakIcon size={20} />;
    return <GlobeIcon size={20} />;
  };

  return (
    <>
      <h3 className="setup-modal__body-title setup-modal__download-heading">
        <span>
          {t("setup_download_word")} {name}
        </span>
        <img
          src={RETROARCH_EMULATOR_ICON}
          alt=""
          className="setup-modal__download-heading-icon"
        />
      </h3>
      <p className="setup-modal__body-intro">
        {t("setup_download_intro", { name })}
      </p>

      <button
        type="button"
        className="setup-modal__website-link"
        onClick={() => openUrl(OFFICIAL_WEBSITE)}
      >
        <GlobeIcon size={14} />
        <span>{t("setup_official_website")}</span>
        <LinkExternalIcon size={12} />
      </button>

      <div className="setup-modal__download-grid">
        {options === null && (
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
        )}

        {installable.map((option) => {
          const isInstalling = installingId === option.id;
          return (
            <div
              key={option.id}
              className="setup-modal__download-card setup-modal__download-card--split"
            >
              <button
                type="button"
                className="setup-modal__download-card-action"
                onClick={() => handleInstall(option.id)}
                disabled={Boolean(installingId) && !isInstalling}
              >
                <div className="setup-modal__download-card-badge">
                  <DownloadIcon size={20} />
                </div>
                <div className="setup-modal__download-card-main">
                  <span className="setup-modal__download-card-title">
                    {t("setup_install_with_hydra")}
                    {option.version ? ` · v${option.version}` : ""}
                    <span className="setup-modal__recommended-pill">
                      {t("setup_recommended")}
                    </span>
                  </span>
                  <span className="setup-modal__download-card-desc">
                    {installStatusText(option.id)}
                  </span>
                  {renderProgressBar(option.id)}
                </div>
              </button>
            </div>
          );
        })}

        {externalLinks.map((option) => (
          <button
            key={option.id}
            type="button"
            className="setup-modal__download-card"
            onClick={() => option.linkUrl && openUrl(option.linkUrl)}
          >
            <div className="setup-modal__download-card-badge">
              {externalLinkIcon(option)}
            </div>
            <div className="setup-modal__download-card-main">
              <span className="setup-modal__download-card-title">
                {externalLinkLabel(option)}
              </span>
              <span className="setup-modal__download-card-desc">
                {option.linkKind === "aur"
                  ? t("setup_install_aur_desc", { name })
                  : t("setup_download_desc", { name })}
              </span>
            </div>
            <span className="setup-modal__download-card-footer">
              <span className="setup-modal__download-card-url">
                {option.linkUrl}
              </span>
              <LinkExternalIcon
                size={14}
                className="setup-modal__download-card-ext"
              />
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
