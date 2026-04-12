import { ChevronDownIcon } from "@primer/octicons-react";
import { useEffect, useReducer, useRef } from "react";
import { useTranslation } from "react-i18next";
import "./release-year-section.scss";

const MIN_YEAR = 1970;
const MAX_YEAR = new Date().getFullYear();

interface ReleaseYearSectionProps {
  title: string;
  color: string;
  value: { gte?: number; lte?: number } | undefined;
  onChange: (value: { gte?: number; lte?: number } | undefined) => void;
}

export function ReleaseYearSection({
  title,
  color,
  value,
  onChange,
}: Readonly<ReleaseYearSectionProps>) {
  const { t } = useTranslation("catalogue");
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOpen, toggleOpen] = useReducer((s) => !s, true);
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  const gte = value?.gte ?? MIN_YEAR;
  const lte = value?.lte ?? MAX_YEAR;
  const isActive = value !== undefined;

  const gtePercent = ((gte - MIN_YEAR) / (MAX_YEAR - MIN_YEAR)) * 100;
  const ltePercent = ((lte - MIN_YEAR) / (MAX_YEAR - MIN_YEAR)) * 100;

  useEffect(() => {
    forceUpdate();
  }, []);

  useEffect(() => {
    if (contentRef.current) {
      forceUpdate();
    }
  }, [isOpen, isActive]);

  const height = isOpen ? (contentRef.current?.scrollHeight ?? 0) : 0;

  const handleGteChange = (newGte: number) => {
    emit(Math.min(newGte, lte), lte);
  };

  const handleLteChange = (newLte: number) => {
    emit(gte, Math.max(newLte, gte));
  };

  const emit = (newGte: number, newLte: number) => {
    const nextGte = newGte === MIN_YEAR ? undefined : newGte;
    const nextLte = newLte === MAX_YEAR ? undefined : newLte;
    onChange(
      nextGte === undefined && nextLte === undefined
        ? undefined
        : { gte: nextGte, lte: nextLte }
    );
  };

  return (
    <div className="filter-section release-year-section">
      <button
        type="button"
        className="filter-section__button"
        onClick={toggleOpen}
        aria-expanded={isOpen}
      >
        <ChevronDownIcon
          className={`filter-section__chevron ${
            isOpen ? "filter-section__chevron--open" : ""
          }`}
        />
        <div className="filter-section__header">
          <div
            className="filter-section__orb"
            style={{ backgroundColor: color }}
          />
          <h3 className="filter-section__title">{title}</h3>
        </div>
      </button>

      <div
        ref={contentRef}
        className="filter-section__content"
        style={{ maxHeight: `${height}px` }}
      >
        <div className="filter-section__content-inner">
          {isActive ? (
            <button
              type="button"
              className="filter-section__clear-button"
              onClick={() => onChange(undefined)}
            >
              {t("clear_filters", { filterCount: 1 })}
            </button>
          ) : (
            <span className="filter-section__count">
              {t("filter_by_release_year")}
            </span>
          )}

          <div className="release-year-section__labels">
            <span>{gte}</span>
            <span>{lte}</span>
          </div>

          <div className="release-year-section__slider-container">
            <div
              className="release-year-section__track"
              style={{
                background: `linear-gradient(
                  to right,
                  rgba(255,255,255,0.12) 0%,
                  rgba(255,255,255,0.12) ${gtePercent}%,
                  ${color} ${gtePercent}%,
                  ${color} ${ltePercent}%,
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
              onChange={(e) => handleGteChange(Number(e.target.value))}
              className="release-year-section__range"
              style={{ zIndex: gte === lte ? 2 : undefined }}
            />
            <input
              type="range"
              min={MIN_YEAR}
              max={MAX_YEAR}
              value={lte}
              onChange={(e) => handleLteChange(Number(e.target.value))}
              className="release-year-section__range"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
