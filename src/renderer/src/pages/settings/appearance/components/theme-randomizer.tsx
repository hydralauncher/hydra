import { useState, useCallback } from "react";
import {
  generateRandomTheme,
  applyRandomTheme,
  clearRandomTheme,
  saveRandomTheme,
  getSavedThemes,
  deleteSavedTheme,
  type RandomTheme,
} from "@renderer/services/theme-randomizer.service";
import { Button } from "@renderer/components";
import { TrashIcon } from "@primer/octicons-react";
import "./theme-randomizer.scss";

const EFFECT_LABELS: Record<string, string> = {
  floatinglines: "Floating Lines",
  particles: "Particles",
  lightrays: "Light Rays",
  colorbends: "Color Bends",
  beams: "Beams",
  pixelblast: "Pixel Blast",
  lightpillar: "Light Pillar",
};

function hslPreviewColor(
  hue: number,
  saturation: number,
  lightness: number
): string {
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

interface ThemePreviewCardProps {
  readonly theme: RandomTheme;
  readonly isActive?: boolean;
  readonly onApply?: () => void;
  readonly onDelete?: () => void;
}

function ThemePreviewCard({
  theme,
  isActive,
  onApply,
  onDelete,
}: ThemePreviewCardProps) {
  const primary = hslPreviewColor(theme.primaryHue, theme.saturation, 55);
  const accent = hslPreviewColor(theme.accentHue, theme.saturation, 60);

  return (
    <div
      className={`theme-rnd__card ${isActive ? "theme-rnd__card--active" : ""}`}
      style={{ borderRadius: theme.borderRadius }}
      role="button"
      tabIndex={0}
      onClick={onApply}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && onApply) onApply();
      }}
      aria-label={`Aplicar tema ${theme.name}`}
    >
      <div className="theme-rnd__card-preview">
        <div
          className="theme-rnd__card-bar"
          style={{
            background: `linear-gradient(135deg, ${primary}, ${accent})`,
          }}
        />
        <div className="theme-rnd__card-stripes">
          {[primary, accent, `hsl(${theme.primaryHue}, 30%, 25%)`].map(
            (c, i) => (
              <div
                key={i}
                className="theme-rnd__card-stripe"
                style={{ background: c, borderRadius: theme.borderRadius / 2 }}
              />
            )
          )}
        </div>
        <div
          className="theme-rnd__card-radius-badge"
          style={{ background: primary, borderRadius: theme.borderRadius }}
        >
          r{theme.borderRadius}
        </div>
      </div>

      <div className="theme-rnd__card-info">
        <span className="theme-rnd__card-name">{theme.name}</span>
        <span className="theme-rnd__card-meta">
          {theme.fontFamily} ·{" "}
          {EFFECT_LABELS[theme.backgroundEffect] ?? theme.backgroundEffect}
        </span>
      </div>

      {onDelete && (
        <button
          type="button"
          className="theme-rnd__card-delete"
          aria-label="Remover tema salvo"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <TrashIcon size={12} />
        </button>
      )}
    </div>
  );
}

export function ThemeRandomizer() {
  const [current, setCurrent] = useState<RandomTheme | null>(null);
  const [saved, setSaved] = useState(() => getSavedThemes());
  const [isSpinning, setIsSpinning] = useState(false);

  const handleRandomize = useCallback(() => {
    setIsSpinning(true);
    setTimeout(() => setIsSpinning(false), 500);

    const theme = generateRandomTheme();
    setCurrent(theme);
    applyRandomTheme(theme);
  }, []);

  const handleSave = useCallback(() => {
    if (!current) return;
    saveRandomTheme(current);
    setSaved(getSavedThemes());
  }, [current]);

  const handleClear = useCallback(() => {
    clearRandomTheme();
    setCurrent(null);
  }, []);

  const handleApplySaved = useCallback((theme: RandomTheme) => {
    setCurrent(theme);
    applyRandomTheme(theme);
  }, []);

  const handleDeleteSaved = useCallback((index: number) => {
    deleteSavedTheme(index);
    setSaved(getSavedThemes());
  }, []);

  return (
    <div className="theme-rnd">
      <div className="theme-rnd__hero">
        <div className="theme-rnd__hero-text">
          <h3 className="theme-rnd__title">Randomizador de Tema</h3>
          <p className="theme-rnd__desc">
            Gere uma combinação aleatória de cores, fontes, bordas e efeito de
            fundo. Salve os que você gostar.
          </p>
        </div>

        <div className="theme-rnd__actions">
          <Button
            theme="primary"
            className={`theme-rnd__spin-btn ${isSpinning ? "theme-rnd__spin-btn--spinning" : ""}`}
            onClick={handleRandomize}
          >
            Randomizar
          </Button>

          {current && (
            <>
              <Button theme="outline" onClick={handleSave}>
                Salvar tema
              </Button>
              <Button theme="outline" onClick={handleClear}>
                Restaurar
              </Button>
            </>
          )}
        </div>
      </div>

      {current && (
        <div className="theme-rnd__current">
          <p className="theme-rnd__section-label">Tema Atual</p>
          <ThemePreviewCard theme={current} isActive />
        </div>
      )}

      {saved.length > 0 && (
        <div className="theme-rnd__saved">
          <p className="theme-rnd__section-label">Temas Salvos</p>
          <div className="theme-rnd__saved-grid">
            {saved.map((t, i) => (
              <ThemePreviewCard
                key={t.savedAt}
                theme={t}
                isActive={
                  current?.name === t.name &&
                  current?.primaryHue === t.primaryHue
                }
                onApply={() => handleApplySaved(t)}
                onDelete={() => handleDeleteSaved(i)}
              />
            ))}
          </div>
        </div>
      )}

      {!current && saved.length === 0 && (
        <div className="theme-rnd__empty">
          <p>
            Clique em <strong>Randomizar</strong> para gerar um tema único.
          </p>
        </div>
      )}
    </div>
  );
}
