import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GlobeIcon,
  LinkExternalIcon,
  DownloadIcon,
} from "@primer/octicons-react";

import type { RetroArchInstallOption, RetroArchInstallProgress } from "@types";

import { RETROARCH_EMULATOR_ICON } from "../../emulator-icons";
import { RETROARCH_LABEL } from "../../retroarch-meta";
import { ArchIcon, FlatpakIcon } from "../brand-icons";
import {
  ExternalLinkCard,
  InstallLoadingCard,
  InstallProgressBar,
  installStatusText,
} from "../install-progress";

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
        {options === null && <InstallLoadingCard />}

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
                    {installStatusText(t, name, progress[option.id])}
                  </span>
                  <InstallProgressBar progress={progress[option.id]} />
                </div>
              </button>
            </div>
          );
        })}

        {externalLinks.map((option) => (
          <ExternalLinkCard
            key={option.id}
            icon={externalLinkIcon(option)}
            title={externalLinkLabel(option)}
            description={
              option.linkKind === "aur"
                ? t("setup_install_aur_desc", { name })
                : t("setup_download_desc", { name })
            }
            url={option.linkUrl}
            onOpen={openUrl}
          />
        ))}
      </div>
    </>
  );
}
