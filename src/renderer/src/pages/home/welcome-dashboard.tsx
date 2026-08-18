import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Tooltip } from "react-tooltip";
import {
  TrophyIcon,
  DatabaseIcon,
  SparkleIcon,
  CloudIcon,
  InfoIcon,
} from "@primer/octicons-react";
import platinumTrophyPng from "@renderer/assets/trophy/platinum.png";
import goldTrophyPng from "@renderer/assets/trophy/gold.png";
import silverTrophyPng from "@renderer/assets/trophy/silver.png";
import bronzeTrophyPng from "@renderer/assets/trophy/bronze.png";
import HydraLogoSvg from "@renderer/assets/icons/hydra.svg?react";
import { useUserDetails } from "@renderer/hooks";
import { useLibrary } from "@renderer/hooks/use-library";
import { useUserLevel } from "@renderer/hooks/use-user-level";
import { formatNumber } from "@renderer/helpers";
import { AnimatedBorder } from "@renderer/components/animated-border/animated-border";

import "./welcome-dashboard.scss";

interface OnlineFriend {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
}

interface StorageDrive {
  name: string;
  free: number;
  total: number;
}

const formatStorageBytes = (bytes: number): string => {
  if (!bytes || bytes <= 0) return "0 GB";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1000) {
    return `${(gb / 1024).toFixed(1)} TB`;
  }
  return `${gb.toFixed(1)} GB`;
};

const formatTotalPlaytimeDetailed = (ms: number): string => {
  if (!ms || ms <= 0) return "0 min";

  let totalMinutes = Math.floor(ms / (1000 * 60));

  const MIN_PER_HOUR = 60;
  const MIN_PER_DAY = 24 * MIN_PER_HOUR;
  const MIN_PER_MONTH = 30 * MIN_PER_DAY;
  const MIN_PER_YEAR = 365 * MIN_PER_DAY;

  const years = Math.floor(totalMinutes / MIN_PER_YEAR);
  totalMinutes %= MIN_PER_YEAR;

  const months = Math.floor(totalMinutes / MIN_PER_MONTH);
  totalMinutes %= MIN_PER_MONTH;

  const days = Math.floor(totalMinutes / MIN_PER_DAY);
  totalMinutes %= MIN_PER_DAY;

  const hours = Math.floor(totalMinutes / MIN_PER_HOUR);
  const minutes = totalMinutes % MIN_PER_HOUR;

  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? "ano" : "anos"}`);
  if (months > 0) parts.push(`${months} ${months === 1 ? "mês" : "meses"}`);
  if (days > 0) parts.push(`${days} ${days === 1 ? "dia" : "dias"}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hora" : "horas"}`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} min`);

  return parts.join(", ");
};

const DEFAULT_AVATARS = [
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g1' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='%233b82f6'/><stop offset='100%' stop-color='%231d4ed8'/></linearGradient></defs><circle cx='32' cy='32' r='32' fill='url(%23g1)'/><circle cx='32' cy='24' r='12' fill='%23ffffff'/><path d='M12 54 C12 40 20 36 32 36 C44 36 52 40 52 54 Z' fill='%23ffffff'/></svg>",
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g2' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='%238b5cf6'/><stop offset='100%' stop-color='%236d28d9'/></linearGradient></defs><circle cx='32' cy='32' r='32' fill='url(%23g2)'/><circle cx='32' cy='24' r='12' fill='%23ffffff'/><path d='M12 54 C12 40 20 36 32 36 C44 36 52 40 52 54 Z' fill='%23ffffff'/></svg>",
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g3' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='%2310b981'/><stop offset='100%' stop-color='%23047857'/></linearGradient></defs><circle cx='32' cy='32' r='32' fill='url(%23g3)'/><circle cx='32' cy='24' r='12' fill='%23ffffff'/><path d='M12 54 C12 40 20 36 32 36 C44 36 52 40 52 54 Z' fill='%23ffffff'/></svg>",
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g4' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='%23f59e0b'/><stop offset='100%' stop-color='%23b45309'/></linearGradient></defs><circle cx='32' cy='32' r='32' fill='url(%23g4)'/><circle cx='32' cy='24' r='12' fill='%23ffffff'/><path d='M12 54 C12 40 20 36 32 36 C44 36 52 40 52 54 Z' fill='%23ffffff'/></svg>",
];

export function WelcomeDashboard() {
  const { t } = useTranslation("home");
  const [drives, setDrives] = useState<StorageDrive[]>([]);
  const [appVersion, setAppVersion] = useState<string>("4.1.0");

  useEffect(() => {
    window.electron
      ?.getVersion()
      .then((v) => {
        if (v) setAppVersion(v);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let isMounted = true;
    const fetchDrives = async () => {
      const candidates = ["C:", "D:", "E:", "F:", "G:", "H:"];
      const loaded: StorageDrive[] = [];

      for (const letter of candidates) {
        try {
          const res = await window.electron.getDiskFreeSpace(`${letter}\\`);
          if (res && res.total > 0) {
            loaded.push({
              name: letter,
              free: res.free,
              total: res.total,
            });
          }
        } catch {
          // Drive not available
        }
      }

      if (isMounted && loaded.length > 0) {
        setDrives(loaded);
      }
    };

    fetchDrives();
    return () => {
      isMounted = false;
    };
  }, []);

  const { userDetails, hasActiveSubscription } = useUserDetails();
  const navigate = useNavigate();
  const { library } = useLibrary();

  const [avatarDecorOptions, setAvatarDecorOptions] = useState({
    border: localStorage.getItem("hydra_avatar_border") || "none",
    speed: Number(localStorage.getItem("hydra_avatar_beam_speed")) || 6,
    color: localStorage.getItem("hydra_avatar_beam_color") || "#ef4444",
    length: Number(localStorage.getItem("hydra_avatar_beam_length")) || 25,
    chaos: Number(localStorage.getItem("hydra_avatar_beam_chaos")) || 0.12,
  });

  useEffect(() => {
    const handleAvatarUpdate = () => {
      setAvatarDecorOptions({
        border: localStorage.getItem("hydra_avatar_border") || "none",
        speed: Number(localStorage.getItem("hydra_avatar_beam_speed")) || 6,
        color: localStorage.getItem("hydra_avatar_beam_color") || "#ef4444",
        length: Number(localStorage.getItem("hydra_avatar_beam_length")) || 25,
        chaos: Number(localStorage.getItem("hydra_avatar_beam_chaos")) || 0.12,
      });
    };

    window.addEventListener(
      "hydra:avatar-decoration-updated",
      handleAvatarUpdate
    );
    return () => {
      window.removeEventListener(
        "hydra:avatar-decoration-updated",
        handleAvatarUpdate
      );
    };
  }, []);

  const [onlineFriends, setOnlineFriends] = useState<OnlineFriend[]>([]);

  useEffect(() => {
    if (!userDetails?.id) {
      setOnlineFriends([]);
      return;
    }

    let isMounted = true;
    window.electron.hydraApi
      .get<{ friends?: OnlineFriend[] }>("/profile/friends", {
        params: { take: 100, skip: 0 },
      })
      .then((data) => {
        if (!isMounted) return;
        setOnlineFriends(
          (data?.friends ?? []).filter(
            (f) => (f as unknown as { currentGame?: unknown }).currentGame
          )
        );
      })
      .catch(() => {
        if (isMounted) setOnlineFriends([]);
      });

    return () => {
      isMounted = false;
    };
  }, [userDetails?.id]);

  const { trophyStats, totalPlaytimeMs, ...levelStats } = useUserLevel();

  const libraryCount = library ? library.length : 0;

  const formattedPlaytime = useMemo(() => {
    return formatTotalPlaytimeDetailed(totalPlaytimeMs);
  }, [totalPlaytimeMs]);

  return (
    <div className="welcome-dashboard">
      <div className="welcome-dashboard__layout">
        {/* LADO ESQUERDO: Perfil do Usuário e Estatísticas de Jogo */}
        <div className="welcome-dashboard__user-panel">
          {/* Card Superior: Avatar, Nick e Amigos Online */}
          <div className="welcome-dashboard__user-card">
            <div className="welcome-dashboard__user-profile-header">
              <div className="welcome-dashboard__user-avatar-wrapper">
                <AnimatedBorder
                  borderWidth={1}
                  containerSize={84}
                  styleName={avatarDecorOptions.border as any}
                  beamSpeed={avatarDecorOptions.speed}
                  beamColor={avatarDecorOptions.color}
                  beamLength={avatarDecorOptions.length}
                  beamChaos={avatarDecorOptions.chaos}
                >
                  <img
                    src={
                      userDetails?.profileImageUrl ||
                      "https://avatar.iran.liara.run/public/boy?username=hydra"
                    }
                    alt={userDetails?.displayName || "User"}
                    className="welcome-dashboard__user-avatar"
                  />
                </AnimatedBorder>
                <span className="welcome-dashboard__green-dot" />
              </div>
              <div className="welcome-dashboard__user-info">
                <h3 className="welcome-dashboard__user-nick">
                  {userDetails?.displayName ||
                    userDetails?.username ||
                    t("usuario", { defaultValue: "Usuário" })}
                </h3>
                <span className="welcome-dashboard__user-tag">
                  {t("online", { defaultValue: "Online" })}
                </span>
              </div>
            </div>

            {/* Amigos Online: 4 bolinhas sobrepostas na esquerda, texto na direita */}
            <div className="welcome-dashboard__user-friends-row">
              <div className="welcome-dashboard__user-friends-avatars">
                {onlineFriends.slice(0, 4).map((friend, idx) => (
                  <img
                    key={friend.id}
                    src={
                      friend.profileImageUrl ||
                      DEFAULT_AVATARS[idx % DEFAULT_AVATARS.length]
                    }
                    alt={friend.displayName}
                    className="welcome-dashboard__user-friend-circle"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src =
                        DEFAULT_AVATARS[idx % DEFAULT_AVATARS.length];
                    }}
                  />
                ))}
              </div>
              <span className="welcome-dashboard__user-friends-text">
                {t("amigos_online_count", {
                  count: onlineFriends.length,
                  defaultValue: `${onlineFriends.length} amigos online`,
                })}
              </span>
            </div>
          </div>

          {/* Card Inferior: Estatísticas da Biblioteca e Tempo Total de Jogo */}
          <div className="welcome-dashboard__user-stats-card">
            <div className="welcome-dashboard__stat-item">
              <div className="welcome-dashboard__stat-header">
                <span className="welcome-dashboard__stat-label">
                  {t("jogos_na_biblioteca", {
                    defaultValue: "Jogos na Biblioteca",
                  })}
                </span>
                <span className="welcome-dashboard__stat-tag">
                  {libraryCount}
                </span>
              </div>
            </div>

            <div className="welcome-dashboard__stat-divider" />

            <div className="welcome-dashboard__stat-item">
              <div className="welcome-dashboard__stat-header">
                <span className="welcome-dashboard__stat-label">
                  {t("tempo_total_jogo_label", {
                    defaultValue: "Tempo Total de Jogo",
                  })}
                </span>
              </div>
              <span className="welcome-dashboard__stat-value welcome-dashboard__stat-value--playtime">
                {formattedPlaytime}
              </span>
            </div>
          </div>

          {/* Botão de Assinar Cloud (Caso o usuário não seja assinante) — mesmo comportamento do botão "Hydra Cloud" da sidebar */}
          {!hasActiveSubscription && (
            <button
              type="button"
              className="welcome-dashboard__subscribe-btn"
              onClick={() =>
                hasActiveSubscription
                  ? navigate("/settings")
                  : window.electron.openExternal(
                      "https://checkout.hydralauncher.gg"
                    )
              }
            >
              <CloudIcon size={14} />
              <span>
                {t("assinar_hydra_cloud", {
                  defaultValue: "Assinar Hydra Cloud",
                })}
              </span>
            </button>
          )}
        </div>

        {/* LADO DIREITO: Bento Grid (2 Colunas) */}
        <div className="welcome-dashboard__bento-grid">
          {/* COLUNA 1: GRANDE em cima, PEQUENO em baixo */}
          <div className="welcome-dashboard__column">
            {/* Card Grande: Conquistas */}
            <div className="welcome-dashboard__card welcome-dashboard__card--big welcome-dashboard__card--trophies">
              <div className="welcome-dashboard__card-header">
                <div className="welcome-dashboard__card-title-group">
                  <TrophyIcon size={16} className="welcome-dashboard__icon" />
                  <h3 className="welcome-dashboard__card-title">
                    {t("trofeus", { defaultValue: "Troféus" })}
                  </h3>
                </div>
                <span className="welcome-dashboard__meta">
                  {t("total", { defaultValue: "Total" })}:{" "}
                  {trophyStats.total.toLocaleString()}
                </span>
              </div>

              <div className="welcome-dashboard__trophies-row">
                <div className="welcome-dashboard__trophy-item">
                  <div className="welcome-dashboard__trophy-badge welcome-dashboard__trophy-badge--platinum">
                    <img
                      src={platinumTrophyPng}
                      alt="Platinum"
                      className="welcome-dashboard__trophy-img"
                    />
                  </div>
                  <span className="welcome-dashboard__trophy-name">
                    {t("platina", { defaultValue: "Platina" })}
                  </span>
                  <span className="welcome-dashboard__trophy-count">
                    {trophyStats.platinum}
                  </span>
                </div>
                <div className="welcome-dashboard__trophy-item">
                  <div className="welcome-dashboard__trophy-badge welcome-dashboard__trophy-badge--gold">
                    <img
                      src={goldTrophyPng}
                      alt="Gold"
                      className="welcome-dashboard__trophy-img"
                    />
                  </div>
                  <span className="welcome-dashboard__trophy-name">
                    {t("ouro", { defaultValue: "Ouro" })}
                  </span>
                  <span className="welcome-dashboard__trophy-count">
                    {formatNumber(trophyStats.gold)}
                  </span>
                </div>
                <div className="welcome-dashboard__trophy-item">
                  <div className="welcome-dashboard__trophy-badge welcome-dashboard__trophy-badge--silver">
                    <img
                      src={silverTrophyPng}
                      alt="Silver"
                      className="welcome-dashboard__trophy-img"
                    />
                  </div>
                  <span className="welcome-dashboard__trophy-name">
                    {t("prata", { defaultValue: "Prata" })}
                  </span>
                  <span className="welcome-dashboard__trophy-count">
                    {formatNumber(trophyStats.silver)}
                  </span>
                </div>
                <div className="welcome-dashboard__trophy-item">
                  <div className="welcome-dashboard__trophy-badge welcome-dashboard__trophy-badge--bronze">
                    <img
                      src={bronzeTrophyPng}
                      alt="Bronze"
                      className="welcome-dashboard__trophy-img"
                    />
                  </div>
                  <span className="welcome-dashboard__trophy-name">
                    {t("bronze", { defaultValue: "Bronze" })}
                  </span>
                  <span className="welcome-dashboard__trophy-count">
                    {formatNumber(trophyStats.bronze)}
                  </span>
                </div>
              </div>
            </div>

            {/* Card Pequeno: Nível e XP do Usuário */}
            <div className="welcome-dashboard__card welcome-dashboard__card--small welcome-dashboard__card--level">
              <button
                type="button"
                className="welcome-dashboard__level-info-btn"
                data-tooltip-id="welcome-dashboard-xp-info"
                aria-label={t("como_funciona_xp", {
                  defaultValue: "Como funciona o XP",
                })}
              >
                <InfoIcon size={12} />
              </button>

              <div className="welcome-dashboard__level-big-group">
                <span className="welcome-dashboard__level-label">
                  {t("nivel", { defaultValue: "NÍVEL" })}
                </span>
                <span className="welcome-dashboard__level-number">
                  {levelStats.userLevel}
                </span>
              </div>

              <div className="welcome-dashboard__xp-container">
                <div className="welcome-dashboard__xp-header">
                  <span className="welcome-dashboard__xp-title">
                    {t("proximo_nivel", {
                      level: levelStats.userLevel + 1,
                      defaultValue: `Nível ${levelStats.userLevel + 1}`,
                    })}
                  </span>
                  <span className="welcome-dashboard__xp-value">
                    {levelStats.xpIntoLevel.toLocaleString()} /{" "}
                    {levelStats.xpNeededForLevel.toLocaleString()} XP
                  </span>
                </div>

                <div className="welcome-dashboard__xp-bar-bg">
                  <div
                    className="welcome-dashboard__xp-bar-fill"
                    style={{ width: `${levelStats.levelProgress}%` }}
                  />
                </div>

                <span className="welcome-dashboard__xp-remaining">
                  {t("xp_restante", {
                    amount: levelStats.xpRemaining,
                    defaultValue: `Faltam ${levelStats.xpRemaining.toLocaleString()} XP para subir`,
                  })}
                </span>
              </div>
            </div>
          </div>

          {/* COLUNA 2: PEQUENO em cima, GRANDE em baixo */}
          <div className="welcome-dashboard__column">
            {/* Card Pequeno: Armazenamento do PC */}
            <div className="welcome-dashboard__card welcome-dashboard__card--small welcome-dashboard__card--storage">
              <div className="welcome-dashboard__card-header">
                <div className="welcome-dashboard__card-title-group">
                  <DatabaseIcon size={16} className="welcome-dashboard__icon" />
                  <h3 className="welcome-dashboard__card-title">
                    {t("armazenamento_pc", {
                      defaultValue: "Armazenamento do PC",
                    })}
                  </h3>
                </div>
                {drives.length > 0 && (
                  <span className="welcome-dashboard__storage-total-free">
                    {formatStorageBytes(
                      drives.reduce((acc, d) => acc + d.free, 0)
                    )}{" "}
                    livres
                  </span>
                )}
              </div>

              <div className="welcome-dashboard__storage-drives-list">
                {drives.length === 0 ? (
                  <div className="welcome-dashboard__storage-drive-item">
                    <div className="welcome-dashboard__storage-drive-info">
                      <span className="welcome-dashboard__storage-drive-name">
                        C:
                      </span>
                      <span className="welcome-dashboard__storage-drive-space">
                        Calculando...
                      </span>
                    </div>
                    <div className="welcome-dashboard__storage-bar">
                      <div
                        className="welcome-dashboard__storage-bar-fill"
                        style={{ width: "0%" }}
                      />
                    </div>
                  </div>
                ) : (
                  drives.map((drive) => {
                    const used = Math.max(0, drive.total - drive.free);
                    const usedPercent = Math.min(
                      100,
                      Math.max(0, Math.round((used / drive.total) * 100))
                    );
                    return (
                      <div
                        key={drive.name}
                        className="welcome-dashboard__storage-drive-item"
                      >
                        <div className="welcome-dashboard__storage-drive-info">
                          <span className="welcome-dashboard__storage-drive-name">
                            {drive.name}
                          </span>
                          <span className="welcome-dashboard__storage-drive-space">
                            {formatStorageBytes(drive.free)} livres de{" "}
                            {formatStorageBytes(drive.total)}
                          </span>
                        </div>
                        <div className="welcome-dashboard__storage-bar">
                          <div
                            className="welcome-dashboard__storage-bar-fill"
                            style={{ width: `${usedPercent}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Card Grande: Novidades e Changelog do Hydra */}
            <div
              className="welcome-dashboard__card welcome-dashboard__card--big welcome-dashboard__card--changelog"
              onClick={() => {
                const widgetBtn = document.querySelector<HTMLButtonElement>(
                  "[data-open-workwonders-changelog-mini], [data-open-workwonders-changelog]"
                );
                if (widgetBtn) widgetBtn.click();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  const widgetBtn = document.querySelector<HTMLButtonElement>(
                    "[data-open-workwonders-changelog-mini], [data-open-workwonders-changelog]"
                  );
                  if (widgetBtn) widgetBtn.click();
                }
              }}
              data-open-workwonders-changelog-mini
              role="button"
              tabIndex={0}
            >
              <div className="welcome-dashboard__changelog-bg" />
              <div className="welcome-dashboard__changelog-overlay" />
              <HydraLogoSvg className="welcome-dashboard__changelog-watermark" />

              <div className="welcome-dashboard__changelog-content">
                <div className="welcome-dashboard__changelog-badge">
                  <SparkleIcon size={12} />
                  <span>
                    {t("novidades_versao", {
                      version: appVersion,
                      defaultValue: `Novidades v${appVersion}`,
                    })}
                  </span>
                </div>

                <div className="welcome-dashboard__changelog-details">
                  <h4 className="welcome-dashboard__changelog-title">
                    {t("o_que_ha_de_novo", {
                      defaultValue: "O que há de novo no Hydra",
                    })}
                  </h4>
                  <p className="welcome-dashboard__changelog-desc">
                    {t("confira_recursos_correcoes", {
                      defaultValue:
                        "Confira os novos recursos, correções e melhorias da versão mais recente.",
                    })}
                  </p>
                  <div className="welcome-dashboard__changelog-action">
                    <span>
                      {t("ver_notas_atualizacao", {
                        defaultValue: "Ver notas da atualização",
                      })}
                    </span>
                    <span className="welcome-dashboard__changelog-arrow">
                      →
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Tooltip
        id="welcome-dashboard-xp-info"
        place="bottom"
        openOnClick
        clickable
        className="welcome-dashboard__xp-info-tooltip"
      >
        <div className="welcome-dashboard__xp-info-content">
          <strong>
            {t("como_ganhar_xp_titulo", {
              defaultValue: "Como você ganha XP",
            })}
          </strong>
          <ul>
            <li>
              {t("xp_regra_platina", {
                defaultValue: "Platinar um jogo (100% das conquistas): +200 XP",
              })}
            </li>
            <li>
              {t("xp_regra_ouro", {
                defaultValue: "Cada troféu de Ouro: +60 XP",
              })}
            </li>
            <li>
              {t("xp_regra_prata", {
                defaultValue: "Cada troféu de Prata: +25 XP",
              })}
            </li>
            <li>
              {t("xp_regra_bronze", {
                defaultValue: "Cada troféu de Bronze: +10 XP",
              })}
            </li>
            <li>
              {t("xp_regra_tempo", {
                defaultValue: "Cada hora jogada: +5 XP",
              })}
            </li>
            <li>
              {t("xp_regra_avaliacao", {
                defaultValue: "Avaliar um jogo: +30 XP",
              })}
            </li>
          </ul>
          <span>
            {t("xp_regra_cloud", {
              defaultValue:
                "Assinantes do Hydra Cloud ganham o triplo de XP por avaliação.",
            })}
          </span>
          <span>
            {t("xp_regra_nivel", {
              defaultValue:
                "Cada nível exige mais XP que o anterior, então o progresso vai ficando mais devagar conforme você sobe.",
            })}
          </span>
        </div>
      </Tooltip>
    </div>
  );
}
