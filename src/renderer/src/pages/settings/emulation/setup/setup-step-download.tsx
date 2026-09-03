import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookIcon, GlobeIcon, LinkExternalIcon } from "@primer/octicons-react";

import type {
  EmulatorBinary,
  EmulatorInstallProgress,
  ResolvedInstallOption,
} from "@types";

import { EMULATOR_ICONS } from "../emulator-icons";
import { KNOWN_BINARY_LABELS } from "../known-binary-labels";
import { ArchIcon, FlatpakIcon, GitHubIcon } from "./brand-icons";
import { firmwarePageUrl } from "./ps-firmware-url";
import {
  ExternalLinkCard,
  InstallLoadingCard,
  InstallProgressBar,
  installStatusText,
} from "./install-progress";

interface Props {
  binary: EmulatorBinary;
}

const OFFICIAL_WEBSITES: Record<EmulatorBinary, string> = {
  duckstation: "https://www.duckstation.org/",
  pcsx2: "https://pcsx2.net/",
  rpcs3: "https://rpcs3.net/",
};

const ARTICLE_KEYS: Record<EmulatorBinary, string> = {
  duckstation: "install-duckstation",
  pcsx2: "install-pcsx2",
  rpcs3: "install-rpcs3",
};

const SEMVER_RE = /v?\d{1,9}\.\d{1,9}(?:\.\d{1,9})?/;

const extractSemver = (value: string | null): string | undefined =>
  (value && SEMVER_RE.exec(value)?.[0]) || undefined;

export function SetupStepDownload({ binary }: Readonly<Props>) {
  const { t, i18n } = useTranslation("settings");
  const name = KNOWN_BINARY_LABELS[binary];
  const icon = EMULATOR_ICONS[binary];

  const [options, setOptions] = useState<ResolvedInstallOption[] | null>(null);
  const [progress, setProgress] = useState<
    Record<string, EmulatorInstallProgress>
  >({});
  const [installingId, setInstallingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    window.electron
      .getEmulatorInstallOptions(binary)
      .then((result) => {
        if (!cancelled) setOptions(result);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [binary]);

  useEffect(() => {
    const unsubscribe = window.electron.onEmulatorInstallProgress((payload) => {
      if (payload.binary !== binary) return;
      setProgress((prev) => ({ ...prev, [payload.optionId]: payload }));
    });
    return unsubscribe;
  }, [binary]);

  const openUrl = (url: string) => {
    window.electron.openExternal(url);
  };

  const handleInstall = async (optionId: string) => {
    if (installingId) return;
    setInstallingId(optionId);
    try {
      await window.electron.installEmulator(binary, optionId);
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

  const channelLabel = (option: ResolvedInstallOption): string | null => {
    if (option.channel === "release") return t("setup_install_channel_stable");
    if (option.channel === "prerelease")
      return t("setup_install_channel_prerelease");
    return null;
  };

  const externalLinkLabel = (option: ResolvedInstallOption): string => {
    if (option.linkKind === "aur") return t("setup_install_aur_note");
    if (option.linkKind === "flatpak") return "Flatpak";
    return t("setup_install_open_releases");
  };

  const externalLinkIcon = (option: ResolvedInstallOption) => {
    if (option.linkKind === "aur") return <ArchIcon size={20} />;
    if (option.linkKind === "flatpak") return <FlatpakIcon size={20} />;
    return <GitHubIcon size={20} />;
  };

  const externalLinkDesc = (option: ResolvedInstallOption): string => {
    if (option.linkKind === "aur") return t("setup_install_aur_desc", { name });
    return t("setup_download_desc", { name });
  };

  const visitLabel = (option: ResolvedInstallOption): string => {
    const semver =
      extractSemver(option.version) ?? extractSemver(option.fileName);
    if (semver) return semver.startsWith("v") ? semver : `v${semver}`;
    if (!option.version) return "GitHub";
    return option.version.length > 14
      ? `${option.version.slice(0, 13)}…`
      : option.version;
  };

  return (
    <>
      <h3 className="setup-modal__body-title setup-modal__download-heading">
        <span>
          {t("setup_download_word")} {name}
        </span>
        {icon && (
          <img
            src={icon}
            alt=""
            className="setup-modal__download-heading-icon"
          />
        )}
      </h3>
      <p className="setup-modal__body-intro">
        {t("setup_download_intro", { name })}
      </p>

      <button
        type="button"
        className="setup-modal__website-link"
        onClick={() => openUrl(OFFICIAL_WEBSITES[binary])}
      >
        <GlobeIcon size={14} />
        <span>{t("setup_official_website")}</span>
        <LinkExternalIcon size={12} />
      </button>

      <div className="setup-modal__download-grid">
        {options === null && <InstallLoadingCard />}

        {installable.map((option) => {
          const label = channelLabel(option);
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
                  <GitHubIcon size={20} />
                </div>
                <div className="setup-modal__download-card-main">
                  <span className="setup-modal__download-card-title">
                    {t("setup_install_with_hydra")}
                    {label ? ` · ${label}` : ""}
                    {option.channel !== "prerelease" && (
                      <span className="setup-modal__recommended-pill">
                        {t("setup_recommended")}
                      </span>
                    )}
                  </span>
                  <span className="setup-modal__download-card-desc">
                    {installStatusText(t, name, progress[option.id])}
                  </span>
                  <InstallProgressBar progress={progress[option.id]} />
                </div>
              </button>
              {option.htmlUrl && (
                <button
                  type="button"
                  className="setup-modal__download-card-visit"
                  onClick={() => option.htmlUrl && openUrl(option.htmlUrl)}
                  title={t("setup_view_on_github")}
                >
                  <span className="setup-modal__download-card-url">
                    {visitLabel(option)}
                  </span>
                  <LinkExternalIcon
                    size={14}
                    className="setup-modal__download-card-ext"
                  />
                </button>
              )}
            </div>
          );
        })}

        {externalLinks.map((option) => (
          <ExternalLinkCard
            key={option.id}
            icon={externalLinkIcon(option)}
            title={externalLinkLabel(option)}
            description={externalLinkDesc(option)}
            url={option.linkUrl}
            onOpen={openUrl}
          />
        ))}

        <hr className="setup-modal__download-divider" />

        <button
          type="button"
          className="setup-modal__download-card setup-modal__download-card--guide"
          data-open-article={ARTICLE_KEYS[binary]}
        >
          <div className="setup-modal__download-card-badge">
            <BookIcon size={20} />
          </div>
          <div className="setup-modal__download-card-main">
            <span className="setup-modal__download-card-title">
              {t("setup_install_guide_workwonders")}
            </span>
            <span className="setup-modal__download-card-desc">
              {t("setup_install_guide_desc", { name })}
            </span>
          </div>
        </button>

        {binary === "rpcs3" && (
          <button
            type="button"
            className="setup-modal__download-card"
            onClick={() => openUrl(firmwarePageUrl(i18n.language))}
          >
            <div className="setup-modal__download-card-badge">
              <GlobeIcon size={20} />
            </div>
            <div className="setup-modal__download-card-main">
              <span className="setup-modal__download-card-title">
                {t("setup_download_firmware_title")}
              </span>
              <span className="setup-modal__download-card-desc">
                {t("setup_download_firmware_desc")}
              </span>
            </div>
            <span className="setup-modal__download-card-footer">
              <span className="setup-modal__download-card-url">
                {firmwarePageUrl(i18n.language)}
              </span>
              <LinkExternalIcon
                size={14}
                className="setup-modal__download-card-ext"
              />
            </span>
          </button>
        )}
      </div>
    </>
  );
}
