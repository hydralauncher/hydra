import { useRef, useState, useEffect, useCallback } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FlameIcon,
  TelescopeIcon,
  ShieldIcon,
  ProjectIcon,
  SlidersIcon,
  TrophyIcon,
  ZapIcon,
  RubyIcon,
  EyeIcon,
  GlobeIcon,
  PeopleIcon,
  StarIcon,
} from "@primer/octicons-react";
import type { Icon } from "@primer/octicons-react";
import "./category-explorer.scss";

interface CategoryItem {
  key: string;
  label: string;
  color: string;
  Icon: Icon;
}

const CATEGORIES: CategoryItem[] = [
  { key: "action", label: "Ação", color: "#ff4757", Icon: FlameIcon },
  {
    key: "adventure",
    label: "Aventura",
    color: "#3867d6",
    Icon: TelescopeIcon,
  },
  { key: "rpg", label: "RPG", color: "#8854d0", Icon: ShieldIcon },
  { key: "strategy", label: "Estratégia", color: "#20bf6b", Icon: ProjectIcon },
  {
    key: "simulation",
    label: "Simulação",
    color: "#45aaf2",
    Icon: SlidersIcon,
  },
  { key: "sports", label: "Esportes", color: "#26de81", Icon: TrophyIcon },
  { key: "racing", label: "Corrida", color: "#fa8231", Icon: ZapIcon },
  { key: "puzzle", label: "Quebra-Cabeça", color: "#a55eea", Icon: RubyIcon },
  { key: "horror", label: "Terror", color: "#eb3b5a", Icon: EyeIcon },
  {
    key: "openworld",
    label: "Mundo Aberto",
    color: "#0fb9b1",
    Icon: GlobeIcon,
  },
  {
    key: "multiplayer",
    label: "Multijogador",
    color: "#4b7bec",
    Icon: PeopleIcon,
  },
  { key: "indie", label: "Indie", color: "#fd9644", Icon: StarIcon },
];

interface CategoryExplorerProps {
  onSelectGenre: (genre: string) => void;
}

export function CategoryExplorer({
  onSelectGenre,
}: Readonly<CategoryExplorerProps>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const hasOverflow = el.scrollWidth > el.clientWidth + 2;
    setCanScrollLeft(hasOverflow && el.scrollLeft > 2);
    setCanScrollRight(
      hasOverflow && el.scrollLeft < el.scrollWidth - el.clientWidth - 2
    );
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      resizeObserver.disconnect();
    };
  }, [updateScrollState]);

  const scroll = (dir: "left" | "right") => {
    if (!trackRef.current) return;
    trackRef.current.scrollBy({
      left: dir === "left" ? -300 : 300,
      behavior: "smooth",
    });
  };

  return (
    <section className="cat-explorer">
      <h2 className="cat-explorer__title">Explore por categoria</h2>

      <div className="cat-explorer__wrapper">
        {canScrollLeft && (
          <button
            type="button"
            className="cat-explorer__nav cat-explorer__nav--left"
            onClick={() => scroll("left")}
            aria-label="Anterior"
          >
            <ChevronLeftIcon size={20} />
          </button>
        )}

        <div className="cat-explorer__track" ref={trackRef}>
          {CATEGORIES.map((cat) => {
            const IconComponent = cat.Icon;
            return (
              <div key={cat.key} className="cat-explorer__item">
                <button
                  type="button"
                  className="cat-explorer__circle-btn"
                  style={{
                    borderColor: cat.color,
                    boxShadow: `0 0 0 1px ${cat.color}22`,
                  }}
                  onClick={() => onSelectGenre(cat.label)}
                  aria-label={`Explorar categoria ${cat.label}`}
                >
                  <span className="cat-explorer__icon-wrap">
                    <IconComponent size={22} />
                  </span>
                </button>
                <span className="cat-explorer__label">{cat.label}</span>
              </div>
            );
          })}
        </div>

        {canScrollRight && (
          <button
            type="button"
            className="cat-explorer__nav cat-explorer__nav--right"
            onClick={() => scroll("right")}
            aria-label="Próximo"
          >
            <ChevronRightIcon size={20} />
          </button>
        )}
      </div>
    </section>
  );
}
