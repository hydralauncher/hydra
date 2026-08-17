import { useState, useCallback, useEffect } from "react";
import {
  applyCustomTheme,
  clearCustomTheme,
  saveCustomTheme,
  loadActiveCustomTheme,
  restoreCustomThemeOnBoot,
  generateRandomElementStyle,
  DEFAULT_CONFIG,
  type CustomThemeConfig,
} from "@renderer/services/theme-customizer.service";
import { generateRandomTheme } from "@renderer/services/theme-randomizer.service";
import { Button } from "@renderer/components";
import { TextField } from "@renderer/components";
import {
  GlobalSection,
  ElementSection,
  BackgroundSection,
} from "./customizer-sections";
import "./theme-customizer.scss";

interface ThemeCustomizerProps {
  onSaved?: () => void;
}

export function ThemeCustomizer({ onSaved }: ThemeCustomizerProps) {
  const [config, setConfig] = useState<CustomThemeConfig>(
    () => loadActiveCustomTheme() ?? DEFAULT_CONFIG
  );
  const [themeName, setThemeName] = useState("");

  useEffect(() => {
    restoreCustomThemeOnBoot();
  }, []);

  const handleChange = useCallback((patch: Partial<CustomThemeConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      applyCustomTheme(next);
      return next;
    });
  }, []);

  const handleClear = useCallback(() => {
    clearCustomTheme();
    setConfig(DEFAULT_CONFIG);
  }, []);

  const handleSave = useCallback(() => {
    if (!themeName.trim()) return;
    saveCustomTheme(themeName.trim(), config);
    setThemeName("");
    onSaved?.();
  }, [themeName, config, onSaved]);

  const handleRandomize = useCallback(() => {
    const rnd = generateRandomTheme();
    const next: CustomThemeConfig = {
      global: {
        borderRadius: rnd.borderRadius,
        font: rnd.fontFamily,
        useGameBackground: config.global.useGameBackground ?? true,
      },
      buttons: generateRandomElementStyle("button"),
      cards: generateRandomElementStyle("card"),
      background: { type: "effect", mediaUrl: "" },
    };
    setConfig(next);
    applyCustomTheme(next);
    localStorage.setItem("hydra_background_effect", rnd.backgroundEffect);
    localStorage.setItem(
      "hydra_background_config",
      JSON.stringify(rnd.backgroundConfig)
    );
    window.dispatchEvent(new Event("background_effect_update"));
  }, [config.global.useGameBackground]);

  return (
    <div className="cz">
      {/* ── Opções ──────────────────────────────────────────────── */}
      <div className="cz__options">
        <p className="cz__section-title">Opções</p>

        <div className="cz__section-body cz__options-row">
          <Button theme="primary" onClick={handleRandomize}>
            Randomizar tema
          </Button>
          <Button theme="outline" onClick={handleClear}>
            Restaurar padrão
          </Button>

          <div className="cz__save-inline">
            <TextField
              label="Nome do tema"
              placeholder="Ex: Dark Neon"
              value={themeName}
              onChange={(e) => setThemeName(e.target.value)}
            />
            <Button
              theme="primary"
              onClick={handleSave}
              disabled={!themeName.trim()}
            >
              Salvar
            </Button>
          </div>
        </div>
      </div>

      {/* ── Fundo ──────────────────────────────────────────────── */}
      <BackgroundSection
        value={config.background}
        onChange={(v) => handleChange({ background: v })}
        globalValue={config.global}
        onGlobalChange={(v) => handleChange({ global: v })}
      />

      {/* ── Global ─────────────────────────────────────────────── */}
      <GlobalSection
        value={config.global}
        onChange={(v) => handleChange({ global: v })}
      />

      {/* ── Botões ─────────────────────────────────────────────── */}
      <ElementSection
        title="Botões"
        value={config.buttons}
        onChange={(v) => handleChange({ buttons: v })}
      />

      {/* ── Cards ──────────────────────────────────────────────── */}
      <ElementSection
        title="Cards"
        value={config.cards}
        onChange={(v) => handleChange({ cards: v })}
      />
    </div>
  );
}
