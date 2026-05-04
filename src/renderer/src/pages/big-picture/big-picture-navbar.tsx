import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  SignOutIcon,
  AppsIcon,
  DownloadIcon,
  GearIcon,
  SearchIcon,
} from "@primer/octicons-react";
import { useDownload, useLibrary } from "@renderer/hooks";
import { useBigPictureContext } from "./big-picture-app";
import "./big-picture-navbar.scss";

const sections = [
  { path: "/big-picture", key: "library", Icon: AppsIcon },
  { path: "/big-picture/catalogue", key: "catalogue", Icon: SearchIcon },
  { path: "/big-picture/downloads", key: "downloads", Icon: DownloadIcon },
  { path: "/big-picture/settings", key: "settings", Icon: GearIcon },
];

export function BigPictureNavbar() {
  const { t } = useTranslation("big_picture");
  const { activeSection, exitBigPicture } = useBigPictureContext();
  const navigate = useNavigate();
  const [time, setTime] = useState(new Date());
  const { lastPacket, downloadSpeed } = useDownload();
  const { library } = useLibrary();

  const activeGame = useMemo(() => {
    if (!lastPacket?.gameId) return null;
    return library.find((game) => game.id === lastPacket.gameId) ?? null;
  }, [library, lastPacket?.gameId]);

  const isDownloading = !!lastPacket && !!activeGame;

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const formattedTime = time.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const formattedDate = time.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <nav className="bp-navbar">
      <div className="bp-navbar__tabs">
        <span className="bp-navbar__bumper">LB</span>
        {sections.map((section, index) => (
          <button
            key={section.path}
            type="button"
            className={`bp-navbar__tab ${
              activeSection === index ? "bp-navbar__tab--active" : ""
            }`}
            onClick={() => navigate(section.path)}
          >
            <section.Icon size={16} />
            <span>{t(section.key)}</span>
          </button>
        ))}
        <span className="bp-navbar__bumper">RB</span>
      </div>

      <div className="bp-navbar__right">
        {isDownloading && (
          <button
            type="button"
            className="bp-navbar__download"
            onClick={() => navigate("/big-picture/downloads")}
            title={`${activeGame!.title} — ${Math.round((lastPacket!.progress ?? 0) * 100)}%`}
          >
            <svg className="bp-navbar__download-ring" viewBox="0 0 44 44">
              <circle
                className="bp-navbar__download-ring-bg"
                cx="22"
                cy="22"
                r="19"
              />
              <circle
                className="bp-navbar__download-ring-fill"
                cx="22"
                cy="22"
                r="19"
                strokeDasharray={2 * Math.PI * 19}
                strokeDashoffset={
                  2 * Math.PI * 19 * (1 - (lastPacket!.progress ?? 0))
                }
              />
            </svg>
            <div className="bp-navbar__download-center">
              <DownloadIcon size={16} />
            </div>
            <span className="bp-navbar__download-speed">{downloadSpeed}</span>
          </button>
        )}
        <div className="bp-navbar__clock">
          <span className="bp-navbar__clock-time">{formattedTime}</span>
          <span className="bp-navbar__clock-date">{formattedDate}</span>
        </div>
        <button
          type="button"
          className="bp-navbar__exit"
          onClick={exitBigPicture}
          title={t("exit_big_picture")}
        >
          <SignOutIcon size={20} />
        </button>
      </div>
    </nav>
  );
}
