import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Modal } from "@renderer/components";
import { gameDetailsContext } from "@renderer/context";
import type {
  ModGameStatus,
  ModProgressEvent,
  ModSort,
  ThunderstorePackage,
} from "@types";
import { translateModsError } from "./mods-error";
import "./mods-modal.scss";

const PAGE_SIZE = 20;

export interface ModsModalProps {
  visible: boolean;
  onClose: () => void;
}

type Community = {
  identifier: string;
  name: string;
  packageLoader: string | null;
};

export function ModsModal({ visible, onClose }: Readonly<ModsModalProps>) {
  const { t, i18n } = useTranslation("mods");
  const { shop, objectId } = useContext(gameDetailsContext);

  const compactNumber = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        notation: "compact",
        maximumFractionDigits: 1,
      }),
    [i18n.language]
  );

  const [status, setStatus] = useState<ModGameStatus | null>(null);
  const [tab, setTab] = useState<"browse" | "installed">("browse");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ModSort>("downloads");
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<ThunderstorePackage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, ModProgressEvent>>(
    {}
  );
  const [communities, setCommunities] = useState<Community[]>([]);
  const [communityFilter, setCommunityFilter] = useState("");

  const refreshStatus = useCallback(async () => {
    if (!objectId) return;
    setStatus(await window.electron.modsGetStatus(shop, objectId));
  }, [shop, objectId]);

  useEffect(() => {
    if (!visible) return;
    refreshStatus().catch((e) => setError(translateModsError(t, e)));
  }, [visible, refreshStatus, t]);

  useEffect(() => {
    if (!visible) return;
    return window.electron.onModProgress((event) => {
      setProgress((prev) => ({ ...prev, [event.fullName]: event }));
      if (event.stage === "done" || event.stage === "error") {
        if (event.message) setError(translateModsError(t, event.message));
        else if (event.stage === "error") setError(translateModsError(t, ""));
        refreshStatus();
      }
    });
  }, [visible, refreshStatus, t]);

  // Community picker data, only needed when auto-detection found nothing.
  useEffect(() => {
    if (!visible || !status || status.community) return;
    window.electron
      .modsListCommunities()
      .then(setCommunities)
      .catch((e) => setError(translateModsError(t, e)));
  }, [visible, status, t]);

  // Debounced search.
  useEffect(() => {
    if (!visible || !status?.community || tab !== "browse") return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const timer = setTimeout(() => {
      window.electron
        .modsSearch(status.community!, {
          query,
          sort,
          page,
          pageSize: PAGE_SIZE,
        })
        .then((result) => {
          if (cancelled) return;
          setItems(result.items);
          setTotal(result.total);
        })
        .catch((e) => !cancelled && setError(translateModsError(t, e)))
        .finally(() => !cancelled && setLoading(false));
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [visible, status?.community, tab, query, sort, page, t]);

  const installedMap = useMemo(
    () => new Map((status?.installed ?? []).map((m) => [m.fullName, m])),
    [status]
  );

  const run = async (task: () => Promise<unknown>) => {
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(translateModsError(t, e));
    } finally {
      refreshStatus();
    }
  };

  const install = (fullName: string) =>
    run(() => window.electron.modsInstall(shop, objectId!, fullName));
  const uninstall = (fullName: string) =>
    run(() => window.electron.modsUninstall(shop, objectId!, fullName, true));
  const toggle = (fullName: string, enabled: boolean) =>
    run(() =>
      window.electron.modsSetEnabled(shop, objectId!, fullName, enabled)
    );

  const pickCommunity = (c: Community) =>
    run(async () => {
      await window.electron.modsSetCommunity(shop, objectId!, c.identifier);
    });

  const renderBody = () => {
    if (!status) return <p className="mods-modal__message">{t("loading")}</p>;

    if (!status.gameDir) {
      return <p className="mods-modal__message">{t("no_game_dir")}</p>;
    }

    if (!status.community) {
      const filtered = communities.filter((c) =>
        c.name.toLowerCase().includes(communityFilter.toLowerCase())
      );
      return (
        <>
          <p className="mods-modal__message">{t("pick_community")}</p>
          <input
            className="mods-modal__input"
            placeholder={t("filter_games_placeholder")}
            value={communityFilter}
            onChange={(e) => setCommunityFilter(e.target.value)}
          />
          <div className="mods-modal__list">
            {filtered.slice(0, 100).map((c) => (
              <div key={c.identifier} className="mods-modal__item">
                <div className="mods-modal__info">
                  <h4>{c.name}</h4>
                  <span className="mods-modal__meta">{c.identifier}</span>
                </div>
                <Button theme="outline" onClick={() => pickCommunity(c)}>
                  {t("use_community")}
                </Button>
              </div>
            ))}
          </div>
        </>
      );
    }

    if (!status.loader) {
      return <p className="mods-modal__message">{t("unsupported_loader")}</p>;
    }

    return (
      <>
        <div className="mods-modal__tabs">
          <Button
            theme={tab === "browse" ? "primary" : "outline"}
            onClick={() => setTab("browse")}
          >
            {t("tab_browse")}
          </Button>
          <Button
            theme={tab === "installed" ? "primary" : "outline"}
            onClick={() => setTab("installed")}
          >
            {t("tab_installed", { count: status.installed.length })}
          </Button>
        </div>

        {tab === "browse" ? renderBrowse() : renderInstalled()}
      </>
    );
  };

  const renderBrowse = () => (
    <>
      <div className="mods-modal__toolbar">
        <input
          className="mods-modal__input"
          placeholder={t("search_placeholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <select
          className="mods-modal__select"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as ModSort);
            setPage(0);
          }}
        >
          <option value="downloads">{t("sort_downloads")}</option>
          <option value="rating">{t("sort_rating")}</option>
          <option value="updated">{t("sort_updated")}</option>
          <option value="name">{t("sort_name")}</option>
        </select>
      </div>

      <div className="mods-modal__list">
        {loading && items.length === 0 && (
          <p className="mods-modal__message">{t("loading_mods")}</p>
        )}
        {!loading && items.length === 0 && (
          <p className="mods-modal__message">{t("no_mods_found")}</p>
        )}
        {items.map((pkg) => {
          const installed = installedMap.get(pkg.fullName);
          const p = progress[pkg.fullName];
          const busy = p && p.stage !== "done" && p.stage !== "error";
          return (
            <div key={pkg.fullName} className="mods-modal__item">
              {pkg.icon && (
                <img
                  className="mods-modal__icon"
                  src={pkg.icon}
                  alt=""
                  loading="lazy"
                />
              )}
              <div className="mods-modal__info">
                <h4>{pkg.name.replace(/_/g, " ")}</h4>
                <div className="mods-modal__meta">
                  {[
                    t("by_author", { owner: pkg.owner }),
                    t("version", { version: pkg.versions[0].version }),
                    t("downloads", {
                      count: pkg.downloads,
                      formatted: compactNumber.format(pkg.downloads),
                    }),
                  ].join(" · ")}
                </div>
                <div className="mods-modal__desc">{pkg.description}</div>
              </div>
              <div className="mods-modal__actions">
                {busy ? (
                  <span className="mods-modal__meta">
                    {t(`stage_${p.stage}`, { percent: p.percent })}
                  </span>
                ) : installed ? (
                  <Button
                    theme="outline"
                    onClick={() => uninstall(pkg.fullName)}
                  >
                    {t("uninstall")}
                  </Button>
                ) : (
                  <Button onClick={() => install(pkg.fullName)}>
                    {t("install")}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mods-modal__pager">
        <Button
          theme="outline"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          {t("previous_page")}
        </Button>
        <span className="mods-modal__meta">
          {t("page_info", {
            page: page + 1,
            pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
            count: total,
          })}
        </span>
        <Button
          theme="outline"
          disabled={(page + 1) * PAGE_SIZE >= total}
          onClick={() => setPage(page + 1)}
        >
          {t("next_page")}
        </Button>
      </div>
    </>
  );

  const renderInstalled = () => (
    <div className="mods-modal__list">
      {status!.installed.length === 0 && (
        <p className="mods-modal__message">{t("no_mods_installed")}</p>
      )}
      {status!.installed.map((mod) => (
        <div key={mod.fullName} className="mods-modal__item">
          <div className="mods-modal__info">
            <h4>{mod.fullName}</h4>
            <div className="mods-modal__meta">
              {[
                t("version", { version: mod.version }),
                mod.isDependency ? t("tag_dependency") : null,
                mod.enabled ? null : t("tag_disabled"),
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <div className="mods-modal__actions">
            <Button
              theme="outline"
              onClick={() => toggle(mod.fullName, !mod.enabled)}
            >
              {mod.enabled ? t("disable") : t("enable")}
            </Button>
            <Button theme="danger" onClick={() => uninstall(mod.fullName)}>
              {t("uninstall")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <Modal
      visible={visible}
      title={t("title")}
      description={
        status?.community
          ? t("subtitle", { community: status.community })
          : undefined
      }
      onClose={onClose}
      large
    >
      <div className="mods-modal">
        {renderBody()}
        {error && <div className="mods-modal__error">{error}</div>}
      </div>
    </Modal>
  );
}
