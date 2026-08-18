import { CalendarIcon, ChevronDownIcon } from "@primer/octicons-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "./release-year-section.scss";

const MIN_YEAR = 1970;
const MAX_YEAR = new Date().getFullYear();

export interface ReleaseYearSectionProps {
  title?: string;
  value: { gte?: number; lte?: number } | undefined;
  onChange: (value: { gte?: number; lte?: number } | undefined) => void;
  icon?: React.ReactNode;
}

export function ReleaseYearSection({
  title,
  value,
  onChange,
  icon,
}: Readonly<ReleaseYearSectionProps>) {
  const { t } = useTranslation("catalogue");
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const popoverId = useId();

  const gte = value?.gte ?? MIN_YEAR;
  const lte = value?.lte ?? MAX_YEAR;
  const isActive = value !== undefined;

  const gtePercent = ((gte - MIN_YEAR) / (MAX_YEAR - MIN_YEAR)) * 100;
  const ltePercent = ((lte - MIN_YEAR) / (MAX_YEAR - MIN_YEAR)) * 100;

  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (
      containerRef.current &&
      !containerRef.current.contains(event.target as Node)
    ) {
      setIsOpen(false);
    }
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      setIsOpen(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleClickOutside, handleKeyDown]);

  const emit = (newGte: number, newLte: number) => {
    const nextGte = newGte === MIN_YEAR ? undefined : newGte;
    const nextLte = newLte === MAX_YEAR ? undefined : newLte;
    onChange(
      nextGte === undefined && nextLte === undefined
        ? undefined
        : { gte: nextGte, lte: nextLte }
    );
  };

  const displayTitle =
    title || t("release_year", { defaultValue: "Ano de lançamento" });

  return (
    <div className="filter-dropdown release-year-dropdown" ref={containerRef}>
      <button
        type="button"
        className={`filter-dropdown__trigger ${
          isOpen ? "filter-dropdown__trigger--open" : ""
        } ${isActive ? "filter-dropdown__trigger--active" : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={popoverId}
      >
        <span className="filter-dropdown__icon">
          {icon ?? <CalendarIcon size={14} />}
        </span>
        <span className="filter-dropdown__title">{displayTitle}</span>
        {isActive && (
          <span className="filter-dropdown__badge">{`${gte}-${lte}`}</span>
        )}
        <ChevronDownIcon
          className={`filter-dropdown__chevron ${
            isOpen ? "filter-dropdown__chevron--open" : ""
          }`}
          size={12}
        />
      </button>

      {isOpen && (
        <div
          id={popoverId}
          className="filter-dropdown__popover release-year-dropdown__popover"
          role="dialog"
          aria-label={displayTitle}
        >
          <div className="filter-dropdown__header">
            <span className="filter-dropdown__count">
              {isActive ? `${gte} — ${lte}` : `${MIN_YEAR} — ${MAX_YEAR}`}
            </span>
            {isActive && (
              <button
                type="button"
                className="filter-dropdown__clear-btn"
                onClick={() => onChange(undefined)}
              >
                {t("clear_filter", { defaultValue: "Limpar" })}
              </button>
            )}
          </div>

          <div className="release-year-section__slider-container">
            <div
              className="release-year-section__track"
              style={{
                background: `linear-gradient(
                  to right,
                  rgba(255,255,255,0.12) 0%,
                  rgba(255,255,255,0.12) ${gtePercent}%,
                  #ffffff ${gtePercent}%,
                  #ffffff ${ltePercent}%,
                  rgba(255,255,255,0.12) ${ltePercent}%,
                  rgba(255,255,255,0.12) 100%
                )`,
              }}
            />
            <input
              type="range"
              min={MIN_YEAR}
              max={MAX_YEAR}
              value={gte}
              onChange={(e) => emit(Math.min(Number(e.target.value), lte), lte)}
              className="release-year-section__range"
              style={{ zIndex: gte === MAX_YEAR ? 2 : 1 }}
              aria-label={t("release_year_gte", {
                defaultValue: "Ano inicial",
              })}
            />
            <input
              type="range"
              min={MIN_YEAR}
              max={MAX_YEAR}
              value={lte}
              onChange={(e) => emit(gte, Math.max(Number(e.target.value), gte))}
              className="release-year-section__range"
              style={{ zIndex: gte === MAX_YEAR ? 1 : 2 }}
              aria-label={t("release_year_lte", { defaultValue: "Ano final" })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
