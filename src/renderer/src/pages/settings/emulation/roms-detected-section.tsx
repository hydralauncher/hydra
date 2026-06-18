import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  SyncIcon,
} from "@primer/octicons-react";

import { Button, TextField } from "@renderer/components";
import { getRegionsFromSkus, getSkuRegionFlag } from "@renderer/helpers";
import { formatBytes } from "@shared";
import type { DetectedRom, EmulatorSystem } from "@types";

interface Props {
  system: EmulatorSystem;
  systemLabel: string;
  onRescan: () => void;
  disabled?: boolean;
  refreshKey?: number;
}

const PAGE_SIZE = 12;

export function RomsDetectedSection({
  system,
  systemLabel,
  onRescan,
  disabled,
  refreshKey,
}: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const [roms, setRoms] = useState<DetectedRom[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    window.electron
      .listEmulatorRoms(system)
      .then((list) => {
        if (!cancelled) setRoms(list);
      })
      .catch(() => {
        if (!cancelled) setRoms([]);
      });
    return () => {
      cancelled = true;
    };
  }, [system, refreshKey]);

  useEffect(() => {
    setPage(0);
  }, [query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roms;
    return roms.filter((rom) => {
      const title = rom.title.toLowerCase();
      return (
        title.includes(q) ||
        rom.skus.some((sku) => sku.toLowerCase().includes(q))
      );
    });
  }, [roms, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);

  const pageSlice = useMemo(
    () =>
      filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [filtered, safePage]
  );

  return (
    <section className="emulator-detail__section">
      <header className="emulator-detail__section-header">
        <div className="emulator-detail__section-text">
          <h3>{t("roms_detected_title")}</h3>
          <p>{t("roms_detected_description", { system: systemLabel })}</p>
        </div>
        <Button theme="outline" onClick={onRescan} disabled={disabled}>
          <SyncIcon size={13} />
          <span>{t("rescan")}</span>
        </Button>
      </header>

      {roms.length === 0 ? (
        <p className="emulator-detail__empty">{t("no_roms_detected")}</p>
      ) : (
        <>
          <TextField
            theme="dark"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("roms_search_placeholder")}
          />

          {filtered.length === 0 ? (
            <p className="emulator-detail__empty">{t("roms_no_results")}</p>
          ) : (
            <>
              <div className="emulator-detail__roms">
                {pageSlice.map((rom) => {
                  const cover = rom.libraryImageUrl ?? rom.iconUrl;
                  const regions = getRegionsFromSkus(rom.skus);
                  return (
                    <div className="emulator-detail__rom" key={rom.objectId}>
                      <div className="emulator-detail__rom-game">
                        <div className="emulator-detail__rom-cover">
                          {cover && (
                            <img
                              src={cover}
                              alt=""
                              loading="lazy"
                              aria-hidden="true"
                            />
                          )}
                        </div>
                        <span
                          className="emulator-detail__rom-title"
                          title={rom.title}
                        >
                          {rom.title}
                        </span>
                      </div>
                      <span
                        className="emulator-detail__rom-leader"
                        aria-hidden="true"
                      />
                      {rom.sizeBytes !== null && (
                        <span className="emulator-detail__rom-size">
                          {formatBytes(rom.sizeBytes)}
                        </span>
                      )}
                      {regions.length > 0 && (
                        <span className="emulator-detail__rom-regions">
                          {regions.map((region) => (
                            <img
                              key={region}
                              className="emulator-detail__rom-flag"
                              src={getSkuRegionFlag(region)}
                              alt={region}
                              title={region}
                            />
                          ))}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {pageCount > 1 && (
                <div className="emulator-detail__pagination">
                  <button
                    type="button"
                    className="emulator-detail__page-btn"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={safePage === 0}
                    aria-label={t("pagination_previous")}
                  >
                    <ChevronLeftIcon size={16} />
                  </button>
                  <span className="emulator-detail__page-indicator">
                    {t("pagination_page_of", {
                      page: safePage + 1,
                      total: pageCount,
                    })}
                  </span>
                  <button
                    type="button"
                    className="emulator-detail__page-btn"
                    onClick={() =>
                      setPage((p) => Math.min(pageCount - 1, p + 1))
                    }
                    disabled={safePage >= pageCount - 1}
                    aria-label={t("pagination_next")}
                  >
                    <ChevronRightIcon size={16} />
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
