import { useTranslation } from "react-i18next";
import {
  BookIcon,
  DownloadIcon,
  LinkExternalIcon,
} from "@primer/octicons-react";

import type { EmulatorBinary } from "@types";

import { EMULATOR_ICONS } from "../emulator-icons";
import { KNOWN_BINARY_LABELS } from "../known-binary-labels";

interface Props {
  binary: EmulatorBinary;
}

interface EmulatorSources {
  download: string;
  guideWindows: string;
  guideLinux: string;
}

const SOURCES: Record<EmulatorBinary, EmulatorSources> = {
  duckstation: {
    download: "https://duckstation.org/",
    guideWindows: "https://github.com/stenzek/duckstation#windows",
    guideLinux: "https://github.com/stenzek/duckstation#linux",
  },
  pcsx2: {
    download: "https://pcsx2.net/",
    guideWindows: "https://pcsx2.net/docs/setup/running/?os=windows",
    guideLinux: "https://pcsx2.net/docs/setup/running/?os=linux",
  },
  rpcs3: {
    download: "https://rpcs3.net/",
    guideWindows: "https://rpcs3.net/quickstart",
    guideLinux: "https://rpcs3.net/quickstart",
  },
};

export function SetupStepDownload({ binary }: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const name = KNOWN_BINARY_LABELS[binary];
  const icon = EMULATOR_ICONS[binary];
  const sources = SOURCES[binary];

  const isWindows = window.electron.platform === "win32";
  const guideUrl = isWindows ? sources.guideWindows : sources.guideLinux;

  const openUrl = (url: string) => {
    window.electron.openExternal(url);
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

      <div className="setup-modal__download-grid">
        <button
          type="button"
          className="setup-modal__download-card"
          onClick={() => openUrl(sources.download)}
        >
          <div className="setup-modal__download-card-badge">
            <DownloadIcon size={20} />
          </div>
          <div className="setup-modal__download-card-main">
            <span className="setup-modal__download-card-title">
              {t("setup_download_link")}
            </span>
            <span className="setup-modal__download-card-desc">
              {t("setup_download_desc", { name })}
            </span>
          </div>
          <span className="setup-modal__download-card-footer">
            <span className="setup-modal__download-card-url">
              {sources.download}
            </span>
            <LinkExternalIcon
              size={14}
              className="setup-modal__download-card-ext"
            />
          </span>
        </button>

        <button
          type="button"
          className="setup-modal__download-card"
          onClick={() => openUrl(guideUrl)}
        >
          <div className="setup-modal__download-card-badge">
            <BookIcon size={20} />
          </div>
          <div className="setup-modal__download-card-main">
            <span className="setup-modal__download-card-title">
              {t("setup_install_guide_link")}
            </span>
            <span className="setup-modal__download-card-desc">
              {t("setup_install_guide_desc", { name })}
            </span>
          </div>
          <span className="setup-modal__download-card-footer">
            <span className="setup-modal__download-card-url">{guideUrl}</span>
            <LinkExternalIcon
              size={14}
              className="setup-modal__download-card-ext"
            />
          </span>
        </button>
      </div>

      <div className="setup-modal__hint" style={{ marginTop: "auto" }}>
        <span>{t("setup_download_official_note")}</span>
      </div>
    </>
  );
}
