import { useAppDispatch, useAppSelector } from "@renderer/hooks";
import { useCatalogue } from "@renderer/hooks/use-catalogue";
import { useLaunchboxFilters } from "@renderer/hooks/use-launchbox-filters";
import { setFilters, setViewMode } from "@renderer/features";
import { useTranslation } from "react-i18next";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  DeviceDesktopIcon,
  ChecklistIcon,
  FlameIcon,
  SlidersIcon,
} from "@primer/octicons-react";
import cn from "classnames";
import { FilterSection } from "./filter-section";
import { CatalogueModeToggle } from "./catalogue-mode-toggle";
import { ReleaseYearSection } from "./release-year-section";
import { formatPlatformAbbr } from "./format-platform-abbr";
import { useCatalogueFilterSections } from "./use-catalogue-filter-sections";
import type { CatalogueSearchPayload } from "@types";
import "./catalogue-header.scss";

const ProtonCompatibilitySection = lazy(async () => {
  const mod = await import("./proton-compatibility-section");
  return { default: mod.ProtonCompatibilitySection };
});

const protonThresholds = [
  {
    value: "silver_plus",
    labelKey: "protondb_silver_plus",
    values: [
      "silver",
      "gold",
      "platinum",
    ] as CatalogueSearchPayload["protondbSupportBadges"],
    color: "rgb(166,166,166)",
  },
  {
    value: "gold_plus",
    labelKey: "protondb_gold_plus",
    values: [
      "gold",
      "platinum",
    ] as CatalogueSearchPayload["protondbSupportBadges"],
    color: "rgb(207,181,59)",
  },
  {
    value: "platinum_only",
    labelKey: "protondb_platinum_only",
    values: ["platinum"] as CatalogueSearchPayload["protondbSupportBadges"],
    color: "rgb(180,199,220)",
  },
];

const areSame = (a: string[], b: string[]) =>
  a.length === b.length && a.every((i) => b.includes(i));

export function CatalogueHeader() {
  const dispatch = useAppDispatch();
  const { t, i18n } = useTranslation("catalogue");
  const { steamDevelopers, steamPublishers, downloadSources } = useCatalogue();
  const { steamGenres, steamUserTags, filters, mode, viewMode } =
    useAppSelector((s) => s.catalogueSearch);
  const launchboxFilters = useLaunchboxFilters(mode === "classics");
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  const shouldShowProton = window.electron.platform === "linux";
  const language = i18n.language.split("-")[0];

  useEffect(() => {
    if (mode === "classics" && launchboxFilters.platforms.length > 0) {
      if (!filters.platforms || filters.platforms.length === 0) {
        const ps2 = launchboxFilters.platforms.find(
          (p) =>
            p.name.toLowerCase().includes("playstation 2") ||
            p.key.toLowerCase().includes("playstation 2") ||
            p.key.toLowerCase() === "ps2"
        );
        dispatch(
          setFilters({
            platforms: [ps2 ? ps2.key : launchboxFilters.platforms[0].key],
          })
        );
      }
    }
  }, [mode, launchboxFilters.platforms, filters.platforms, dispatch]);

  const activeFiltersCount = useMemo(() => {
    return (
      (filters.genres?.length || 0) +
      (filters.tags?.length || 0) +
      (filters.developers?.length || 0) +
      (filters.publishers?.length || 0) +
      (filters.downloadSourceFingerprints?.length || 0) +
      (filters.releaseYear ? 1 : 0) +
      (filters.protondbSupportBadges?.length || 0) +
      (filters.deckCompatibility?.length || 0)
    );
  }, [filters]);

  const activeSections = useCatalogueFilterSections({
    mode,
    filters,
    language,
    steamGenres,
    steamUserTags,
    steamDevelopers,
    steamPublishers,
    downloadSources,
    launchboxFilters,
  });

  const handleSelect = (key: string, value: string) => {
    const list = (filters[key as keyof typeof filters] as string[]) || [];
    const next = list.includes(value)
      ? list.filter((i) => i !== value)
      : [...list, value];
    dispatch(setFilters({ [key]: next }));
  };

  const isDeckCompatible = areSame(filters.deckCompatibility, [
    "playable",
    "verified",
  ]);
  const protonVal =
    protonThresholds.find((th) =>
      areSame(filters.protondbSupportBadges, th.values)
    )?.value ?? "";

  return (
    <div className="catalogue-header" data-gamepad-ignore="true">
      <div className="catalogue-header__main">
        <div className="catalogue-header__left">
          <CatalogueModeToggle />

          {mode === "modern" && (
            <button
              type="button"
              className={`catalogue-header__view-toggle ${viewMode === "all" ? "catalogue-header__view-toggle--active" : ""}`}
              onClick={() =>
                dispatch(setViewMode(viewMode === "all" ? "curated" : "all"))
              }
              title={viewMode === "all" ? "Ver destaques" : "Ver todos"}
            >
              {viewMode === "all" ? (
                <FlameIcon size={12} />
              ) : (
                <ChecklistIcon size={12} />
              )}
              <span>{viewMode === "all" ? "Destaques" : "Ver todos"}</span>
            </button>
          )}
        </div>

        <div className="catalogue-header__right">
          {isFiltersOpen && (
            <div className="catalogue-header__filters">
              {mode === "modern" && shouldShowProton && (
                <Suspense fallback={null}>
                  <ProtonCompatibilitySection
                    title={t("protondb")}
                    protonSliderLabel={t("protondb_minimum")}
                    deckSliderLabel={t("steam_deck_minimum")}
                    protonOptions={protonThresholds.map((th) => ({
                      value: th.value,
                      label: t(th.labelKey),
                      color: th.color,
                    }))}
                    protonValue={protonVal}
                    deckChecked={isDeckCompatible}
                    deckLabel={t("steam_deck_compatible")}
                    icon={<DeviceDesktopIcon size={12} />}
                    onProtonChange={(val) => {
                      const th = protonThresholds.find((t) => t.value === val);
                      dispatch(
                        setFilters({
                          protondbSupportBadges: th ? [...th.values] : [],
                        })
                      );
                    }}
                    onDeckChange={(checked) =>
                      dispatch(
                        setFilters({
                          deckCompatibility: checked
                            ? ["playable", "verified"]
                            : [],
                        })
                      )
                    }
                  />
                </Suspense>
              )}

              {mode === "modern" && (
                <ReleaseYearSection
                  title="Ano"
                  value={filters.releaseYear}
                  onChange={(val) => dispatch(setFilters({ releaseYear: val }))}
                />
              )}

              {activeSections.map((sec) => (
                <FilterSection
                  key={sec.key}
                  title={sec.title}
                  icon={sec.icon}
                  items={sec.items}
                  onClear={() => dispatch(setFilters({ [sec.key]: [] }))}
                  onSelect={(val) => handleSelect(sec.key, val as string)}
                />
              ))}
            </div>
          )}

          <button
            type="button"
            className={cn("catalogue-header__filter-toggle", {
              "catalogue-header__filter-toggle--active":
                isFiltersOpen || activeFiltersCount > 0,
            })}
            onClick={() => setIsFiltersOpen((prev) => !prev)}
            title="Filtros"
          >
            <SlidersIcon size={12} />
            <span>Filtros</span>
            {activeFiltersCount > 0 && (
              <span className="catalogue-header__filter-badge">
                {activeFiltersCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {mode === "classics" && launchboxFilters.platforms.length > 0 && (
        <div className="catalogue-header__platform-tabs">
          {launchboxFilters.platforms.map((p) => {
            const isSelected = (filters.platforms || []).includes(p.key);
            return (
              <button
                key={p.key}
                type="button"
                className={cn("catalogue-header__platform-tab", {
                  "catalogue-header__platform-tab--active": isSelected,
                })}
                onClick={() => {
                  dispatch(setFilters({ platforms: [p.key] }));
                }}
              >
                {formatPlatformAbbr(p.name)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
