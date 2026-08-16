import { useRef } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";
import "./category-explorer.scss";

const STEAM_GENRES = [
  { key: "action", label: "Ação" },
  { key: "adventure", label: "Aventura" },
  { key: "rpg", label: "RPG" },
  { key: "strategy", label: "Estratégia" },
  { key: "simulation", label: "Simulação" },
  { key: "sports", label: "Esportes" },
  { key: "racing", label: "Corrida" },
  { key: "puzzle", label: "Quebra-Cabeça" },
  { key: "horror", label: "Terror" },
  { key: "openworld", label: "Mundo Aberto" },
  { key: "fighting", label: "Luta" },
  { key: "city", label: "Construção de Cidades" },
];

interface CategoryExplorerProps {
  onSelectGenre: (genre: string) => void;
}

export function CategoryExplorer({
  onSelectGenre,
}: Readonly<CategoryExplorerProps>) {
  const trackRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: "left" | "right") => {
    if (!trackRef.current) return;
    trackRef.current.scrollBy({
      left: dir === "left" ? -400 : 400,
      behavior: "smooth",
    });
  };

  return (
    <section className="cat-explorer">
      <h2 className="cat-explorer__title">Explore por categoria</h2>

      <div className="cat-explorer__wrapper">
        <button
          type="button"
          className="cat-explorer__nav cat-explorer__nav--left"
          onClick={() => scroll("left")}
          aria-label="Anterior"
        >
          <ChevronLeftIcon size={24} />
        </button>

        <div className="cat-explorer__track" ref={trackRef}>
          {STEAM_GENRES.map((genre) => (
            <button
              key={genre.key}
              type="button"
              className={`cat-explorer__card cat-explorer__card--${genre.key}`}
              onClick={() => onSelectGenre(genre.label)}
              aria-label={`Explorar ${genre.label}`}
            >
              <div className="cat-explorer__bg" />
              <div className="cat-explorer__gradient" />
              <span className="cat-explorer__label">{genre.label}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="cat-explorer__nav cat-explorer__nav--right"
          onClick={() => scroll("right")}
          aria-label="Próximo"
        >
          <ChevronRightIcon size={24} />
        </button>
      </div>
    </section>
  );
}
