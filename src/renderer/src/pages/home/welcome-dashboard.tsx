import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  TrophyIcon,
  CloudIcon,
  PeopleIcon,
  SparkleIcon,
  InfoIcon,
  ImageIcon,
  ShieldIcon,
} from "@primer/octicons-react";
import "./welcome-dashboard.scss";

export function WelcomeDashboard() {
  const { t } = useTranslation("home");

  const [stats] = useState({
    totalTrophies: 1933,
    platinum: 13,
    gold: 89,
    silver: 297,
    bronze: 1534,
    userLevel: 264,
    levelProgress: 20,
  });

  const friendsOnline = [
    {
      id: "1",
      name: "jackalope4_20",
      avatar: "https://avatar.iran.liara.run/public/boy?username=jackalope4_20",
    },
    {
      id: "2",
      name: "MR_ChiefBigTotem",
      avatar:
        "https://avatar.iran.liara.run/public/boy?username=MR_ChiefBigTotem",
    },
  ];

  return (
    <div className="welcome-dashboard">
      <div className="welcome-dashboard__bento-grid">
        {/* COLUNA 1: GRANDE em cima, PEQUENO em baixo */}
        <div className="welcome-dashboard__column">
          {/* Card Grande: Conquistas */}
          <div className="welcome-dashboard__card welcome-dashboard__card--big welcome-dashboard__card--trophies">
            <div className="welcome-dashboard__card-header">
              <div className="welcome-dashboard__card-title-group">
                <TrophyIcon size={16} className="welcome-dashboard__icon" />
                <h3 className="welcome-dashboard__card-title">
                  {t("trophies", { defaultValue: "Trophies" })}
                </h3>
              </div>
              <span className="welcome-dashboard__meta">
                {t("total", { defaultValue: "Total" })}:{" "}
                {stats.totalTrophies.toLocaleString()}
              </span>
            </div>

            <div className="welcome-dashboard__trophies-row">
              <div className="welcome-dashboard__trophy-item">
                <div className="welcome-dashboard__trophy-badge welcome-dashboard__trophy-badge--platinum">
                  🏆
                </div>
                <span className="welcome-dashboard__trophy-count">
                  {stats.platinum}
                </span>
              </div>
              <div className="welcome-dashboard__trophy-item">
                <div className="welcome-dashboard__trophy-badge welcome-dashboard__trophy-badge--gold">
                  🥇
                </div>
                <span className="welcome-dashboard__trophy-count">
                  {stats.gold}
                </span>
              </div>
              <div className="welcome-dashboard__trophy-item">
                <div className="welcome-dashboard__trophy-badge welcome-dashboard__trophy-badge--silver">
                  🥈
                </div>
                <span className="welcome-dashboard__trophy-count">
                  {stats.silver}
                </span>
              </div>
              <div className="welcome-dashboard__trophy-item">
                <div className="welcome-dashboard__trophy-badge welcome-dashboard__trophy-badge--bronze">
                  🥉
                </div>
                <span className="welcome-dashboard__trophy-count">1.5K</span>
              </div>
            </div>

            <div className="welcome-dashboard__level-footer">
              <div className="welcome-dashboard__level-badge">
                <ShieldIcon size={13} />
                <span>Level {stats.userLevel}</span>
              </div>
              <div className="welcome-dashboard__level-progress-bg">
                <div
                  className="welcome-dashboard__level-progress-fill"
                  style={{ width: `${stats.levelProgress}%` }}
                />
              </div>
              <span className="welcome-dashboard__level-percent">
                {stats.levelProgress}%
              </span>
            </div>
          </div>

          {/* Card Pequeno: Controle DualSense */}
          <div className="welcome-dashboard__card welcome-dashboard__card--small welcome-dashboard__card--controller">
            <div className="welcome-dashboard__controller-icon-wrapper">
              <div className="welcome-dashboard__controller-ring" />
              <svg
                className="welcome-dashboard__controller-svg"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-3H8v-2h3v-3h2v3h3v2h-3v3h-2z" />
              </svg>
            </div>
            <div className="welcome-dashboard__controller-info">
              <span className="welcome-dashboard__controller-title">
                DualSense Wireless Controller
              </span>
              <div className="welcome-dashboard__controller-battery">
                <span className="welcome-dashboard__battery-icon">🔋</span>
              </div>
            </div>
          </div>
        </div>

        {/* COLUNA 2: PEQUENO em cima, GRANDE em baixo */}
        <div className="welcome-dashboard__column">
          {/* Card Pequeno: Armazenamento */}
          <div className="welcome-dashboard__card welcome-dashboard__card--small welcome-dashboard__card--storage">
            <div className="welcome-dashboard__card-header">
              <div className="welcome-dashboard__card-title-group">
                <CloudIcon size={16} className="welcome-dashboard__icon" />
                <h3 className="welcome-dashboard__card-title">
                  Console Storage
                </h3>
              </div>
              <InfoIcon size={15} className="welcome-dashboard__info-icon" />
            </div>

            <div className="welcome-dashboard__storage-content">
              <div className="welcome-dashboard__storage-meta">
                <span className="welcome-dashboard__storage-dot" />
                <span className="welcome-dashboard__storage-label">
                  Free space
                </span>
                <span className="welcome-dashboard__storage-value">
                  47.32 GB
                </span>
              </div>
              <div className="welcome-dashboard__storage-bar">
                <div
                  className="welcome-dashboard__storage-segment welcome-dashboard__storage-segment--blue"
                  style={{ width: "65%" }}
                />
                <div
                  className="welcome-dashboard__storage-segment welcome-dashboard__storage-segment--purple"
                  style={{ width: "15%" }}
                />
                <div
                  className="welcome-dashboard__storage-segment welcome-dashboard__storage-segment--orange"
                  style={{ width: "8%" }}
                />
              </div>
            </div>
          </div>

          {/* Card Grande: Store / Hydra Destaque */}
          <div className="welcome-dashboard__card welcome-dashboard__card--big welcome-dashboard__card--store">
            <div className="welcome-dashboard__store-bg" />
            <div className="welcome-dashboard__store-overlay" />
            <div className="welcome-dashboard__store-content">
              <div className="welcome-dashboard__store-badge">
                <SparkleIcon size={12} />
                <span>Hydra Store</span>
              </div>

              <div className="welcome-dashboard__store-details">
                <h4 className="welcome-dashboard__store-title">
                  RISE OF THE RONIN
                </h4>
                <div className="welcome-dashboard__store-footer">
                  <span className="welcome-dashboard__store-platform">PS5</span>
                  <span className="welcome-dashboard__store-price">$69.99</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* COLUNA 3: GRANDE em cima, PEQUENO em baixo */}
        <div className="welcome-dashboard__column">
          {/* Card Grande: Media Gallery / Notícias */}
          <div className="welcome-dashboard__card welcome-dashboard__card--big welcome-dashboard__card--media">
            <div className="welcome-dashboard__media-bg" />
            <div className="welcome-dashboard__media-overlay" />
            <div className="welcome-dashboard__card-header welcome-dashboard__media-header">
              <div className="welcome-dashboard__card-title-group">
                <ImageIcon size={16} className="welcome-dashboard__icon" />
                <h3 className="welcome-dashboard__card-title">Media Gallery</h3>
              </div>
            </div>
            <div className="welcome-dashboard__media-footer">
              <span className="welcome-dashboard__media-tag">
                Latest Captures
              </span>
            </div>
          </div>

          {/* Card Pequeno: Amigos Online */}
          <div className="welcome-dashboard__card welcome-dashboard__card--small welcome-dashboard__card--friends">
            <div className="welcome-dashboard__card-header">
              <div className="welcome-dashboard__card-title-group">
                <PeopleIcon size={16} className="welcome-dashboard__icon" />
                <h3 className="welcome-dashboard__card-title">
                  Online Friends
                </h3>
              </div>
              <div className="welcome-dashboard__friends-online-badge">
                <span className="welcome-dashboard__green-dot" />
                <span>{friendsOnline.length}</span>
              </div>
            </div>

            <div className="welcome-dashboard__friends-avatars-row">
              <div className="welcome-dashboard__avatars-stack">
                {friendsOnline.map((friend) => (
                  <img
                    key={friend.id}
                    src={friend.avatar}
                    alt={friend.name}
                    className="welcome-dashboard__friend-avatar"
                  />
                ))}
              </div>
              <span className="welcome-dashboard__friends-names">
                {friendsOnline.map((f) => f.name).join(", ")}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
