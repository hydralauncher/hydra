import { useState, useEffect, useId, type ReactNode } from "react";
import "./background-effect-settings.scss";
import { TextField, Button } from "@renderer/components";
import {
  IconNone,
  IconDarkVeil,
  IconLightPillar,
  IconFloatingLines,
  IconLightRays,
  IconColorBends,
  IconParticles,
  IconBeams,
  IconPixelBlast,
} from "./effect-icons";

// ── helpers ────────────────────────────────────────────────────────────────────
function humanize(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
}

const effectIcons: Record<string, ReactNode> = {
  none: <IconNone size={18} />,
  darkveil: <IconDarkVeil size={18} />,
  lightpillar: <IconLightPillar size={18} />,
  floatinglines: <IconFloatingLines size={18} />,
  lightrays: <IconLightRays size={18} />,
  colorbends: <IconColorBends size={18} />,
  particles: <IconParticles size={18} />,
  beams: <IconBeams size={18} />,
  pixelblast: <IconPixelBlast size={18} />,
};

// ── prop overrides: fields to skip, radio options, custom ranges ───────────────
const SKIP_PROPS: Record<string, string[]> = {
  lightrays: ["distortion"],
};

const RADIO_PROPS: Record<string, Record<string, string[]>> = {
  lightrays: {
    raysOrigin: [
      "top-left",
      "top-center",
      "top-right",
      "center",
      "bottom-left",
      "bottom-center",
      "bottom-right",
    ],
  },
};

interface PropRange {
  min: number;
  max: number;
  step: number;
}
const PROP_RANGES: Record<string, Record<string, PropRange>> = {
  lightpillar: {
    glowAmount: { min: 0, max: 0.05, step: 0.001 },
  },
  particles: {
    speed: { min: 0, max: 1, step: 0.01 },
    particleBaseSize: { min: 0.1, max: 5, step: 0.1 },
  },
};

// ── effect config ──────────────────────────────────────────────────────────────
export const effectsInfo: Record<
  string,
  { label: string; defaults: Record<string, unknown>; info: string }
> = {
  none: { label: "Nenhum", defaults: {}, info: "Sem fundo animado" },
  darkveil: {
    label: "Dark Veil",
    defaults: {
      hueShift: 0,
      noiseIntensity: 0,
      scanlineIntensity: 0,
      speed: 0.5,
      scanlineFrequency: 0,
      warpAmount: 0,
    },
    info: "Neblina etérea e fluida com ajustes de matiz e scanlines",
  },
  lightpillar: {
    label: "Light Pillar",
    defaults: {
      topColor: "#5227FF",
      bottomColor: "#FF9FFC",
      intensity: 1,
      rotationSpeed: 0.3,
      glowAmount: 0.002,
      pillarWidth: 3,
      pillarHeight: 0.4,
      noiseIntensity: 0.5,
      pillarRotation: 25,
      interactive: false,
    },
    info: "Pilar de luz luminoso e expansível",
  },
  floatinglines: {
    label: "Floating Lines",
    defaults: {
      linesGradient: ["#a5cfaa", "#273f3b"],
      lineCount: 5,
      lineDistance: 5,
      bendRadius: 5,
      bendStrength: -0.5,
      interactive: true,
      parallax: true,
    },
    info: "Linhas flutuantes responsivas ao mouse",
  },
  lightrays: {
    label: "Light Rays",
    defaults: {
      raysOrigin: "top-center",
      raysColor: "#ffffff",
      raysSpeed: 1,
      lightSpread: 0.5,
      rayLength: 3,
      followMouse: true,
      mouseInfluence: 0.1,
      noiseAmount: 0,
      pulsating: false,
      fadeDistance: 1,
      saturation: 1,
    },
    info: "Raios de luz volumétricos projetados na tela",
  },
  colorbends: {
    label: "Color Bends",
    defaults: {
      colors: ["#ff5c7a", "#8a5cff", "#00ffd1"],
      rotation: 0,
      speed: 0.2,
      scale: 1,
      frequency: 1,
      warpStrength: 1,
      mouseInfluence: 1,
      parallax: 0.5,
      noise: 0.1,
      transparent: true,
      autoRotate: 0,
    },
    info: "Distorções coloridas fluidas com estilo gradiente mesh",
  },
  particles: {
    label: "Particles",
    defaults: {
      particleColors: ["#ffffff"],
      particleCount: 200,
      particleSpread: 10,
      speed: 0.1,
      particleBaseSize: 1,
      moveParticlesOnHover: true,
      alphaParticles: false,
      disableRotation: false,
    },
    info: "Nuvem de partículas 3D espaciais",
  },
  beams: {
    label: "Beams",
    defaults: {
      beamWidth: 3,
      beamHeight: 30,
      beamNumber: 20,
      lightColor: "#ffffff",
      speed: 2,
      noiseIntensity: 1.75,
      scale: 0.2,
      rotation: 30,
    },
    info: "Feixes de luz volumétricos 3D com ruído animado",
  },
  pixelblast: {
    label: "Pixel Blast",
    defaults: {
      color: "#07e874",
      pixelSize: 3,
      patternScale: 3.5,
      patternDensity: 1.6,
      rippleSpeed: 0.3,
      rippleThickness: 0.07,
      rippleIntensityScale: 1.2,
      speed: 0.4,
      transparent: true,
      edgeFade: 0.4,
      enableRipples: true,
      variant: "square",
    },
    info: "Partículas pixeladas interativas (estilo Matrix)",
  },
};

// ── sub-components ─────────────────────────────────────────────────────────────
interface ToggleProps {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}
function Toggle({ id, checked, onChange }: ToggleProps) {
  return (
    <label className="bg-effect__toggle" htmlFor={id} aria-label="toggle">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="bg-effect__toggle-track" />
    </label>
  );
}

interface SliderProps {
  label: string;
  value: number;
  range: PropRange;
  onChange: (v: number) => void;
}
function SliderProp({ label, value, range, onChange }: SliderProps) {
  return (
    <div className="bg-effect__prop">
      <label>{label}</label>
      <div className="bg-effect__prop-row">
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        <span className="bg-effect__prop-value">{value}</span>
      </div>
    </div>
  );
}

// ── main component ─────────────────────────────────────────────────────────────
export function BackgroundEffectSettings() {
  const uid = useId();
  const [effect, setEffect] = useState<string>("none");
  const [config, setConfig] = useState<Record<string, unknown>>({});

  useEffect(() => {
    const sync = () => {
      const ef =
        localStorage.getItem("hydra_background_effect") || "floatinglines";
      setEffect(ef);
      try {
        const confStr = localStorage.getItem("hydra_background_config");
        const parsed = confStr ? JSON.parse(confStr) : {};
        const defaultConf = effectsInfo[ef]?.defaults || {};

        if (Object.keys(parsed).length === 0) {
          setConfig(defaultConf);
        } else {
          setConfig({ ...defaultConf, ...parsed });
        }
      } catch {
        setConfig(effectsInfo[ef]?.defaults || {});
      }
    };

    sync(); // leitura inicial

    window.addEventListener("background_effect_update", sync);
    return () => window.removeEventListener("background_effect_update", sync);
  }, []);

  const handleEffectChange = (newEffect: string) => {
    const conf = effectsInfo[newEffect].defaults;
    setEffect(newEffect);
    setConfig(conf);
    localStorage.setItem("hydra_background_effect", newEffect);
    localStorage.setItem("hydra_background_config", JSON.stringify(conf));
    window.dispatchEvent(new Event("background_effect_update"));
  };

  const handleConfigChange = (key: string, value: unknown) => {
    const newConf = { ...config, [key]: value };
    setConfig(newConf);
    localStorage.setItem("hydra_background_config", JSON.stringify(newConf));
    window.dispatchEvent(new Event("background_effect_update"));
  };

  const currentInfo = effectsInfo[effect];
  const skipped = SKIP_PROPS[effect] ?? [];
  const radios = RADIO_PROPS[effect] ?? {};
  const ranges = PROP_RANGES[effect] ?? {};

  const entries = Object.entries(currentInfo.defaults).filter(
    ([k]) => !skipped.includes(k)
  );

  const colorProps = entries.filter(
    ([, dv]) =>
      (typeof dv === "string" && (dv as string).startsWith("#")) ||
      (Array.isArray(dv) && (dv as string[])[0]?.startsWith("#"))
  );
  const numberProps = entries.filter(
    ([k, dv]) => typeof dv === "number" && !radios[k]
  );
  const boolProps = entries.filter(([, dv]) => typeof dv === "boolean");
  const radioProps = Object.entries(radios);
  const stringProps = entries.filter(
    ([k, dv]) =>
      typeof dv === "string" && !(dv as string).startsWith("#") && !radios[k]
  );

  return (
    <div className="bg-effect">
      {/* tabs */}
      <div className="bg-effect__selectors">
        {Object.entries(effectsInfo).map(([key, info]) => (
          <Button
            key={key}
            theme={effect === key ? "primary" : "outline"}
            className="bg-effect__btn"
            onClick={() => handleEffectChange(key)}
          >
            <span className="bg-effect__btn-icon">{effectIcons[key]}</span>
            {info.label}
          </Button>
        ))}
      </div>

      {/* header */}
      <div className="bg-effect__info">
        <div className="bg-effect__info-icon">{effectIcons[effect]}</div>
        <div className="bg-effect__info-text">
          <h3>{currentInfo.label}</h3>
          <p>{currentInfo.info}</p>
        </div>
      </div>

      {/* config */}
      {effect !== "none" && (
        <div className="bg-effect__config">
          {colorProps.length > 0 && (
            <Section title="Cores">
              <div className="bg-effect__section-body">
                {colorProps.map(([key, defaultValue]) => {
                  const val = (config[key] ?? defaultValue) as
                    | string
                    | string[];
                  if (Array.isArray(val)) {
                    return (
                      <div key={key} className="bg-effect__prop">
                        <label>{humanize(key)}</label>
                        <div className="bg-effect__color-array">
                          {val.map((color, i) => (
                            <div key={i} className="bg-effect__color-row">
                              <div className="bg-effect__color-input">
                                <input
                                  type="color"
                                  value={color.substring(0, 7)}
                                  onChange={(e) => {
                                    const n = [...val];
                                    n[i] = e.target.value;
                                    handleConfigChange(key, n);
                                  }}
                                />
                                <TextField
                                  value={color}
                                  onChange={(e) => {
                                    const n = [...val];
                                    n[i] = e.target.value;
                                    handleConfigChange(key, n);
                                  }}
                                />
                              </div>
                              <button
                                type="button"
                                className="bg-effect__remove-color"
                                onClick={() => {
                                  const n = val.filter((_, j) => j !== i);
                                  if (n.length > 0) handleConfigChange(key, n);
                                }}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <Button
                            theme="outline"
                            className="bg-effect__add-color"
                            onClick={() =>
                              handleConfigChange(key, [...val, "#ffffff"])
                            }
                          >
                            + Adicionar Cor
                          </Button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={key} className="bg-effect__prop">
                      <label>{humanize(key)}</label>
                      <div className="bg-effect__color-input">
                        <input
                          type="color"
                          value={(val as string).substring(0, 7)}
                          onChange={(e) =>
                            handleConfigChange(key, e.target.value)
                          }
                        />
                        <TextField
                          value={val as string}
                          onChange={(e) =>
                            handleConfigChange(key, e.target.value)
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {numberProps.length > 0 && (
            <Section title="Ajustes">
              <div className="bg-effect__section-grid">
                {numberProps.map(([key, defaultValue]) => {
                  const val = (config[key] ?? defaultValue) as number;
                  const dv = defaultValue as number;
                  const custom = ranges[key];
                  const range: PropRange = custom ?? {
                    min: dv === 0 ? -10 : 0,
                    max: Math.max(dv * 3, 10),
                    step: dv % 1 !== 0 || dv === 0 ? 0.05 : 1,
                  };
                  return (
                    <SliderProp
                      key={key}
                      label={humanize(key)}
                      value={val}
                      range={range}
                      onChange={(v) => handleConfigChange(key, v)}
                    />
                  );
                })}
              </div>
            </Section>
          )}

          {radioProps.length > 0 && (
            <Section title="Posição / Tipo">
              <div className="bg-effect__section-body">
                {radioProps.map(([key, options]) => {
                  const val = (config[key] ??
                    currentInfo.defaults[key]) as string;
                  return (
                    <div key={key} className="bg-effect__prop">
                      <label>{humanize(key)}</label>
                      <div className="bg-effect__radio-group">
                        {options.map((opt) => (
                          <label
                            key={opt}
                            className={`bg-effect__radio ${val === opt ? "bg-effect__radio--active" : ""}`}
                          >
                            <input
                              type="radio"
                              name={`${uid}-${key}`}
                              value={opt}
                              checked={val === opt}
                              onChange={() => handleConfigChange(key, opt)}
                            />
                            {opt}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {stringProps.length > 0 && (
            <Section title="Opções">
              <div className="bg-effect__section-body">
                {stringProps.map(([key, defaultValue]) => {
                  const val = (config[key] ?? defaultValue) as string;
                  return (
                    <div key={key} className="bg-effect__prop">
                      <label>{humanize(key)}</label>
                      <TextField
                        value={val}
                        onChange={(e) =>
                          handleConfigChange(key, e.target.value)
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {boolProps.length > 0 && (
            <Section title="Comportamento">
              <div className="bg-effect__section-body">
                {boolProps.map(([key, defaultValue]) => {
                  const val = (config[key] ?? defaultValue) as boolean;
                  const inputId = `${uid}-${key}`;
                  return (
                    <div
                      key={key}
                      className="bg-effect__prop bg-effect__prop--toggle"
                    >
                      <label htmlFor={inputId}>{humanize(key)}</label>
                      <Toggle
                        id={inputId}
                        checked={val}
                        onChange={(v) => handleConfigChange(key, v)}
                      />
                    </div>
                  );
                })}
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-effect__section">
      <p className="bg-effect__section-title">{title}</p>
      {children}
    </div>
  );
}
