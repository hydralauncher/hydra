import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./theme-editor.scss";
import Editor from "@monaco-editor/react";
import { Theme } from "@types";
import { useSearchParams } from "react-router-dom";
import { Button } from "@renderer/components";
import { CheckIcon, UploadIcon } from "@primer/octicons-react";
import { injectCustomCss } from "@renderer/helpers";
import { levelDBService } from "@renderer/services/leveldb.service";
import {
  EditorDocument,
  EditorState,
  HYDRA_TARGETS,
  HYDRA_FONT_PRESETS,
  TargetStyle,
  VisualLayer,
  findTarget,
  findTargetBySelector,
  getAllTargets,
  generateVisualCss,
  mergeVisualCss,
  importCommunityCss,
} from "./theme-editor-engine";

const EMPTY_STYLE: TargetStyle = {
  color: "",
  backgroundColor: "",
  backgroundImage: "",
  backgroundSize: "cover",
  backgroundPosition: "center",
  backgroundRepeat: "no-repeat",
  opacity: 1,
  borderColor: "",
  borderWidth: 0,
  borderRadius: 0,
  boxShadow: "",
  fontSize: 16,
  fontWeight: 400,
  letterSpacing: 0,
  padding: "",
  margin: "",
  gap: 0,
  transform: "",
  transition: "all .2s ease",
  backdropFilter: "",
  filter: "",
  fontFamily: "Noto Sans",
  fontStyle: "normal",
  lineHeight: "normal",
  textTransform: "none",
  borderStyle: "solid",
  zIndex: 0,
  customProperties: {},
};

const CATEGORIES = [
  "Global",
  "Navegação",
  "Controles",
  "Formulários",
  "Cards",
  "Páginas",
  "Janelas",
  "Menus",
  "Notificações",
  "Imagens e mídia",
  "Estados",
  "Componentes",
  "Tipografia",
  "CSS detectado",
];

const STATES: { id: EditorState; label: string }[] = [
  { id: "normal", label: "Normal" },
  { id: "hover", label: "Hover" },
  { id: "active", label: "Ativo" },
  { id: "focus", label: "Foco" },
  { id: "disabled", label: "Desabilitado" },
  { id: "selected", label: "Selecionado" },
];

const makeId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const defaultDocument = (): EditorDocument => ({
  rules: [],
  layers: [],
  variables: {},
  conditions: [],
  discoveredTargets: [],
});

export default function ThemeEditor() {
  const [searchParams] = useSearchParams();
  const themeId = searchParams.get("themeId");

  const [theme, setTheme] = useState<Theme | null>(null);
  const [document, setDocument] = useState<EditorDocument>(defaultDocument);
  const [baseCode, setBaseCode] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"visual" | "css" | "assets">("visual");
  const [category, setCategory] = useState("Global");
  const [selectedTarget, setSelectedTarget] = useState(HYDRA_TARGETS[0].id);
  const [selectedState, setSelectedState] = useState<EditorState>("normal");
  const [search, setSearch] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [cssImportMessage, setCssImportMessage] = useState("");
  const [importChanges, setImportChanges] = useState<
    ReturnType<typeof importCommunityCss>["changes"]
  >([]);
  const [communityCss, setCommunityCss] = useState("");
  const [previewCss, setPreviewCss] = useState("");
  const [inspectorTab, setInspectorTab] = useState<
    "style" | "layout" | "effects" | "advanced"
  >("style");
  const [previewSelection, setPreviewSelection] = useState<string | null>(null);
  const [fontScope, setFontScope] = useState<
    | "global"
    | "sidebar"
    | "header"
    | "buttons"
    | "cards"
    | "titles"
    | "body"
    | "inputs"
  >("global");
  const editorRef = useRef<any>(null);
  const decorationRef = useRef<string[]>([]);
  const previewHostRef = useRef<HTMLDivElement>(null);

  const allTargets = useMemo(
    () => getAllTargets(document.discoveredTargets ?? []),
    [document.discoveredTargets]
  );
  const target =
    findTarget(selectedTarget, document.discoveredTargets ?? []) ??
    allTargets[0] ??
    HYDRA_TARGETS[0];

  useEffect(() => {
    window.document.title = "Hydra - Theme Editor";
  }, []);

  useEffect(() => {
    if (!themeId) return;
    levelDBService.get(themeId, "themes").then((loadedTheme) => {
      const loaded = loadedTheme as Theme | null;
      if (!loaded) return;
      setTheme(loaded);
      setBaseCode(loaded.code || "");
      setCode(loaded.code || "");
      injectCustomCss(loaded.code || "");
    });
  }, [themeId]);

  useEffect(() => {
    const unsubscribe = window.electron.onThemePreviewElementClicked(
      (selectors) => {
        const candidates = Array.isArray(selectors) ? selectors : [selectors];
        const hit = candidates
          .map((selector) =>
            findTargetBySelector(
              [selector],
              [...(document.discoveredTargets ?? []), ...allTargets]
            )
          )
          .find(Boolean);

        if (hit) {
          selectTarget(hit.id);
          setPreviewSelection(hit.id);
        }
      }
    );

    return unsubscribe;
  }, [document.discoveredTargets, allTargets]);

  useEffect(() => {
    if (!previewEnabled || !previewCss) return;
    void window.electron.updateThemePreviewCss(themeId ?? "", previewCss);
  }, [previewCss, previewEnabled, themeId]);

  useEffect(() => {
    if (!themeId) return;

    const hidePreview = () => {
      void window.electron.updateThemePreviewBounds(themeId, {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
    };

    // O Hydra real pertence exclusivamente ao Editor Visual.
    // Em CSS/Assets ele precisa ficar completamente fora da área útil.
    if (!previewEnabled || mode !== "visual" || !previewHostRef.current) {
      hidePreview();
      return;
    }

    const sendBounds = () => {
      const host = previewHostRef.current;
      if (!host) {
        hidePreview();
        return;
      }

      const rect = host.getBoundingClientRect();

      // O retângulo é relativo à janela do editor. Só enviamos
      // dimensões válidas para o WebContentsView.
      if (rect.width <= 0 || rect.height <= 0) {
        hidePreview();
        return;
      }

      void window.electron.updateThemePreviewBounds(themeId, {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };

    sendBounds();

    const observer = new ResizeObserver(sendBounds);
    observer.observe(previewHostRef.current);

    window.addEventListener("resize", sendBounds);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sendBounds);

      // Sempre que o modo mudar, o preview anterior é escondido antes
      // de o novo layout assumir a tela.
      hidePreview();
    };
  }, [themeId, mode, previewEnabled]);

  const _visualCss = useMemo(() => generateVisualCss(document), [document]);

  const updatePreview = useCallback(
    (nextDocument: EditorDocument, nextBaseCode = baseCode) => {
      const nextCss = generateVisualCss(nextDocument);
      const merged = mergeVisualCss(nextBaseCode, nextCss);
      setCode(merged);
      setPreviewCss(merged);
      if (previewEnabled) injectCustomCss(merged);
    },
    [baseCode, previewEnabled]
  );

  const getRule = (targetId: string, state: EditorState) =>
    document.rules.find(
      (rule) => rule.targetId === targetId && rule.state === state
    );

  const updateStyle = (patch: Partial<TargetStyle>) => {
    const existing = getRule(selectedTarget, selectedState);
    const rules = [...document.rules];

    if (existing) {
      const index = rules.indexOf(existing);
      rules[index] = {
        ...existing,
        style: { ...existing.style, ...patch },
      };
    } else {
      rules.push({
        targetId: selectedTarget,
        state: selectedState,
        style: { ...EMPTY_STYLE, ...patch },
      });
    }

    const next = { ...document, rules };
    setDocument(next);
    setHasUnsavedChanges(true);
    updatePreview(next);
  };

  const updateLayer = (id: string, patch: Partial<VisualLayer>) => {
    const next = {
      ...document,
      layers: document.layers.map((layer) =>
        layer.id === id ? { ...layer, ...patch } : layer
      ),
    };
    setDocument(next);
    setHasUnsavedChanges(true);
    updatePreview(next);
  };

  const removeLayer = (id: string) => {
    const next = {
      ...document,
      layers: document.layers.filter((layer) => layer.id !== id),
    };
    setDocument(next);
    setHasUnsavedChanges(true);
    updatePreview(next);
  };

  const addLayer = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: "Imagens",
          extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"],
        },
      ],
    });

    if (!filePaths?.[0]) return;

    const layer: VisualLayer = {
      id: makeId(),
      name: "Nova textura",
      kind: "texture",
      targetId: selectedTarget,
      image: filePaths[0],
      opacity: 0.15,
      size: "cover",
      position: "center",
      repeat: "no-repeat",
      blendMode: "overlay",
      enabled: true,
    };

    const next = { ...document, layers: [...document.layers, layer] };
    setDocument(next);
    setHasUnsavedChanges(true);
    updatePreview(next);
  };

  const save = async () => {
    if (!theme) return;
    await window.electron.updateCustomTheme(theme.id, code);
    setBaseCode(code);
    setHasUnsavedChanges(false);
    const refreshed = (await levelDBService.get(
      theme.id,
      "themes"
    )) as Theme | null;
    if (refreshed) setTheme(refreshed);
  };

  useEffect(() => {
    if (previewEnabled && previewCss) injectCustomCss(previewCss);
  }, [previewEnabled, previewCss]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const filteredTargets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allTargets.filter(
      (item) =>
        item.category === category &&
        (!q ||
          item.label.toLowerCase().includes(q) ||
          item.selector.toLowerCase().includes(q))
    );
  }, [allTargets, category, search]);

  const currentRule = getRule(selectedTarget, selectedState);
  const currentStyle = { ...EMPTY_STYLE, ...(currentRule?.style ?? {}) };
  const selectTarget = (id: string, state: EditorState = "normal") => {
    const item = findTarget(id);
    if (!item) return;
    setSelectedTarget(id);
    setSelectedState(state);
    setCategory(item.category);
    setPreviewSelection(id);
  };
  const _previewTarget = (selectors: string[]) =>
    findTargetBySelector(selectors, document.discoveredTargets ?? []);
  const _selectedPreviewStyle = (id?: string): React.CSSProperties => ({
    outline: id && previewSelection === id ? "2px solid #4cc2ff" : undefined,
    outlineOffset: id && previewSelection === id ? "2px" : undefined,
    position: "relative",
    zIndex: id && previewSelection === id ? 20 : undefined,
  });
  const visibleImportChanges = useMemo(
    () =>
      importChanges.filter(
        (change) => !change.targetId || change.targetId === selectedTarget
      ),
    [importChanges, selectedTarget]
  );

  const updateCustomProperty = (property: string, value: string) => {
    const existing = getRule(selectedTarget, selectedState);
    const rules = [...document.rules];
    if (existing) {
      const index = rules.indexOf(existing);
      rules[index] = {
        ...existing,
        style: {
          ...existing.style,
          customProperties: {
            ...(existing.style.customProperties ?? {}),
            [property]: value,
          },
        },
      };
    } else {
      rules.push({
        targetId: selectedTarget,
        state: selectedState,
        style: { ...EMPTY_STYLE, customProperties: { [property]: value } },
      });
    }
    const next = { ...document, rules };
    setDocument(next);
    setHasUnsavedChanges(true);
    updatePreview(next);
  };

  const updateVariable = (name: string, value: string) => {
    const next = {
      ...document,
      variables: { ...(document.variables ?? {}), [name]: value },
    };
    setDocument(next);
    setHasUnsavedChanges(true);
    updatePreview(next);
  };

  const addVariable = () => {
    const name = `--theme-${Object.keys(document.variables ?? {}).length + 1}`;
    updateVariable(name, "#ffffff");
  };

  const readCssIntoEditor = () => {
    const result = importCommunityCss(code);

    if (
      !result.recognizedRules &&
      !Object.keys(result.document.variables ?? {}).length &&
      !result.document.discoveredTargets?.length
    ) {
      setImportChanges(result.changes);
      setCommunityCss(code);
      setCssImportMessage(
        "O CSS foi carregado, mas nenhum seletor conhecido foi convertido para o editor visual."
      );
      setPreviewCss(code);
      if (previewEnabled) injectCustomCss(code);
      return;
    }

    setDocument(result.document);
    setImportChanges(result.changes);
    setCommunityCss(code);
    setHasUnsavedChanges(true);

    // Critical: imported CSS is immediately applied to the real Hydra preview.
    // The visual model is also populated from the imported declarations.
    setBaseCode(code);
    setPreviewCss(code);
    if (previewEnabled) injectCustomCss(code);

    const unknown = result.unknownSelectors.length;
    setCssImportMessage(
      `${result.recognizedRules} regras · ${result.recognizedDeclarations} propriedades convertidas para a engine` +
      (unknown ? ` · ${unknown} seletores mantidos como CSS bruto` : "")
    );
    setMode("visual");

    // Focus first recognized target, making the imported modifications visible.
    const first = result.changes.find((change) => change.status !== "unknown");
    if (first) {
      setSelectedTarget(first.targetId);
      setSelectedState(first.state);
      setCategory(
        findTarget(first.targetId, result.document.discoveredTargets ?? [])
          ?.category ?? "Global"
      );
    }
  };

  const updateCode = (next: string) => {
    setCode(next);
    setBaseCode(next);
    setPreviewCss(next);
    setHasUnsavedChanges(true);
    if (previewEnabled) injectCustomCss(next);
  };

  // Monaco CSS is a live source of truth. Persisting the active theme after a
  // short debounce makes Hydra reload the complete CSS, not just visual edits.
  useEffect(() => {
    if (!theme || !hasUnsavedChanges) return;

    const timer = window.setTimeout(async () => {
      try {
        await window.electron.updateCustomTheme(theme.id, code);
        if (previewEnabled) injectCustomCss(code);
      } catch (error) {
        console.error("failed to live-preview custom theme:", error);
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [code, hasUnsavedChanges, theme, previewEnabled]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !importChanges.length) {
      if (editor)
        decorationRef.current = editor.deltaDecorations(
          decorationRef.current,
          []
        );
      return;
    }
    const model = editor.getModel();
    if (!model) return;
    const decorations = importChanges.slice(0, 500).map((change) => {
      const index = Math.max(0, code.indexOf(change.selector));
      const line = model.getPositionAt(index).lineNumber;
      const className = `theme-editor-source-line--${change.status}`;
      return {
        range: {
          startLineNumber: line,
          startColumn: 1,
          endLineNumber: line,
          endColumn: 1,
        },
        options: {
          isWholeLine: true,
          className,
          overviewRuler: {
            color:
              change.status === "recognized"
                ? "#35e3a0"
                : change.status === "partial"
                  ? "#f4c84c"
                  : "#ef5555",
            position: 4,
          },
          minimap: {
            color:
              change.status === "recognized"
                ? "#35e3a0"
                : change.status === "partial"
                  ? "#f4c84c"
                  : "#ef5555",
            position: 2,
          },
          hoverMessage: {
            value: `**${change.targetLabel}**\n\n\`${change.selector}\`\n\nPropriedades: ${change.properties.join(", ")}${change.conditions?.length ? `\n\nCondições: ${change.conditions.join(" | ")}` : ""}`,
          },
        },
      };
    });
    decorationRef.current = editor.deltaDecorations(
      decorationRef.current,
      decorations
    );
  }, [code, importChanges]);

  return (
    <div
      className={`theme-editor-pro ${window.electron.platform === "darwin" ? "theme-editor-pro--darwin" : ""}`}
    >
      <header className="theme-editor-pro__topbar">
        <div className="brand">
          <div className="brand__mark">H</div>
          <div>
            <strong>HYDRA</strong>
            <span>THEME EDITOR</span>
          </div>
        </div>

        <div className="topbar-title">
          <strong>Personalize tudo. Do seu jeito.</strong>
          <span>Editor visual completo para temas do Hydra.</span>
        </div>

        <div className="topbar-actions">
          <Button
            theme="outline"
            onClick={() => setDocument(defaultDocument())}
          >
            Novo
          </Button>
          <Button theme="outline" onClick={() => setMode("css")}>
            Código CSS
          </Button>
          <Button theme="outline" onClick={addLayer}>
            <UploadIcon /> Assets
          </Button>
          <Button
            theme="outline"
            onClick={() => void save()}
            disabled={!hasUnsavedChanges}
          >
            <CheckIcon /> Salvar
          </Button>
          <Button theme="primary" onClick={() => void save()}>
            Aplicar no Hydra
          </Button>
        </div>
      </header>

      <div className="theme-editor-pro__toolbar">
        <div className="mode-tabs">
          <button
            className={mode === "visual" ? "active" : ""}
            onClick={() => setMode("visual")}
          >
            ▣ Editor Visual
          </button>
          <button
            className={mode === "css" ? "active" : ""}
            onClick={() => setMode("css")}
          >
            {"</>"} Código CSS
          </button>
          <button
            className={mode === "assets" ? "active" : ""}
            onClick={() => setMode("assets")}
          >
            ▧ Assets
          </button>
        </div>
        <div className="toolbar-right">
          <span>Modo de visualização</span>
          <select defaultValue="hydra">
            <option value="hydra">Hydra (Principal)</option>
            <option value="big-picture">Big Picture</option>
          </select>
          <label className="switch">
            <input
              checked={previewEnabled}
              onChange={(e) => setPreviewEnabled(e.target.checked)}
              type="checkbox"
            />
            <span />
          </label>
          <small>Preview em tempo real</small>
        </div>
      </div>

      {mode === "css" ? (
        <section className="css-mode">
          <div className="css-import-bar css-import-bar--compact">
            <strong>CSS da comunidade</strong>
            <button className="css-read-button" onClick={readCssIntoEditor}>
              ⚡ Ler CSS
            </button>
            {cssImportMessage && <small>{cssImportMessage}</small>}
          </div>
          <Editor
            theme="vs-dark"
            onMount={(editor) => {
              editorRef.current = editor;
            }}
            language="css"
            value={code}
            onChange={(value) => updateCode(value ?? "")}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              wordWrap: "on",
              automaticLayout: true,
              padding: { top: 18 },
            }}
          />
        </section>
      ) : (
        <>
          {communityCss && (
            <div className="imported-theme-strip">
              <div>
                <strong>Tema da comunidade carregado</strong>
                <span>
                  {importChanges.filter((c) => c.status !== "unknown").length}{" "}
                  modificações detectadas · o CSS original permanece como base.
                </span>
              </div>
              <button
                onClick={() => {
                  setMode("css");
                }}
              >
                Ver CSS original
              </button>
            </div>
          )}
          <main className="theme-editor-pro__workspace">
            <aside className="panel navigation">
              <div className="panel-title">NAVEGAÇÃO</div>
              <div className="search-box">
                <input
                  placeholder="Buscar componente..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="category-list">
                {CATEGORIES.map((item) => (
                  <button
                    key={item}
                    className={category === item ? "active" : ""}
                    onClick={() => setCategory(item)}
                  >
                    <span>{category === item ? "▸" : "·"}</span>
                    {item}
                  </button>
                ))}
              </div>
              <div className="target-list">
                {filteredTargets.map((item) => (
                  <button
                    key={item.id}
                    className={selectedTarget === item.id ? "selected" : ""}
                    onClick={() => {
                      setSelectedTarget(item.id);
                      setSelectedState("normal");
                    }}
                  >
                    <span>□</span>
                    {item.label}
                  </button>
                ))}
              </div>
            </aside>

            <section className="center">
              <div className="panel-title center-title">
                PREVIEW — HYDRA (PRINCIPAL) — {target.label.toUpperCase()}
                <span className="live-dot">● LIVE</span>
              </div>
              <div
                ref={previewHostRef}
                className="hydra-preview theme-editor-preview theme-editor-preview-host"
              >
                <div className="real-preview-placeholder">
                  <div className="real-preview-placeholder__title">
                    HYDRA REAL — PREVIEW
                  </div>
                  <div className="real-preview-placeholder__text">
                    Navegue normalmente. Segure <kbd>Ctrl</kbd> e clique em
                    qualquer elemento para selecioná-lo no editor.
                  </div>
                </div>
              </div>
              <div className="bottom-panels">
                <div className="mini-panel states">
                  <div className="panel-title">ESTADOS DO ELEMENTO</div>
                  {STATES.map((item) => (
                    <button
                      key={item.id}
                      className={selectedState === item.id ? "active" : ""}
                      onClick={() => setSelectedState(item.id)}
                    >
                      ● {item.label}
                    </button>
                  ))}
                </div>
                <div className="mini-panel assets">
                  <div className="panel-title">
                    ASSETS DO TEMA{" "}
                    <button onClick={addLayer}>＋ Adicionar</button>
                  </div>
                  <div className="asset-grid">
                    {document.layers.length === 0 && (
                      <div className="empty-assets">
                        Adicione imagens, texturas e overlays.
                      </div>
                    )}
                    {document.layers.map((layer) => (
                      <div className="asset" key={layer.id}>
                        <div className="asset-thumb">▧</div>
                        <span>{layer.name}</span>
                        <button
                          title="Remover camada"
                          onClick={() => removeLayer(layer.id)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mini-panel generated">
                  <div className="panel-title">ALTERAÇÕES DETECTADAS</div>
                  <div className="change-list">
                    {visibleImportChanges.length === 0 && (
                      <div className="empty-assets">
                        Importe um tema CSS para identificar as variáveis e
                        condições modificadas.
                      </div>
                    )}
                    {visibleImportChanges.slice(0, 80).map((change, index) => (
                      <button
                        key={`${change.selector}-${index}`}
                        className={`change-row ${change.status}`}
                        onClick={() => {
                          if (change.targetId) {
                            setSelectedTarget(change.targetId);
                            setSelectedState(change.state);
                            setCategory(
                              findTarget(
                                change.targetId,
                                document.discoveredTargets ?? []
                              )?.category ?? "Global"
                            );
                          }
                        }}
                      >
                        <span className="change-marker" />
                        <span className="change-main">
                          <strong>{change.targetLabel}</strong>
                          <code>{change.selector}</code>
                        </span>
                        <span className="change-properties">
                          {change.properties.join(", ")}
                          {change.conditions?.length
                            ? ` · ${change.conditions.join(" | ")}`
                            : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <aside className="panel inspector">
              <div className="panel-title">PROPRIEDADES DO ELEMENTO</div>
              <div className="element-name">
                <span>{target.label}</span>
                <code>{target.selector}</code>
              </div>

              <div className="inspector-tabs">
                {(
                  [
                    ["style", "Estilo"],
                    ["layout", "Layout"],
                    ["effects", "Efeitos"],
                    ["advanced", "Avançado"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    className={inspectorTab === id ? "active" : ""}
                    onClick={() => setInspectorTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="inspector-change-summary">
                <span className="summary-marker" />
                <div>
                  <strong>{target.label}</strong>
                  <code>{target.selector}</code>
                </div>
                <small>
                  {currentRule
                    ? `${Object.keys(currentRule.style).length} propriedades alteradas`
                    : "Sem alterações ainda"}
                </small>
              </div>
              {inspectorTab === "style" && (
                <>
                  {category === "Tipografia" && (
                    <div className="font-editor-card">
                      <div className="section-heading-row">
                        <strong>EDITOR DE FONTES</strong>
                        <span className="font-scope-badge">{fontScope}</span>
                      </div>
                      <label>Área que será alterada</label>
                      <select
                        className="wide-input"
                        value={fontScope}
                        onChange={(e) => {
                          const scope = e.target.value as typeof fontScope;
                          setFontScope(scope);
                          const map: Record<typeof fontScope, string> = {
                            global: "font-global",
                            sidebar: "font-sidebar",
                            header: "font-header",
                            buttons: "font-button",
                            cards: "font-game-card",
                            titles: "font-title",
                            body: "font-body-text",
                            inputs: "font-input",
                          };
                          const id = map[scope];
                          if (id) selectTarget(id);
                        }}
                      >
                        <option value="global">Hydra inteiro</option>
                        <option value="sidebar">Somente Sidebar</option>
                        <option value="header">Somente Header</option>
                        <option value="buttons">Todos os botões</option>
                        <option value="cards">Cards / jogos</option>
                        <option value="titles">Títulos</option>
                        <option value="body">Textos</option>
                        <option value="inputs">Campos / formulários</option>
                      </select>
                      <label>Modelo de fonte</label>
                      <select
                        className="wide-input"
                        value={
                          currentStyle.fontFamily ??
                          HYDRA_FONT_PRESETS[0].family
                        }
                        onChange={(e) =>
                          updateStyle({ fontFamily: e.target.value })
                        }
                      >
                        {HYDRA_FONT_PRESETS.map((font) => (
                          <option key={font.id} value={font.family}>
                            {font.label}
                          </option>
                        ))}
                      </select>
                      <div
                        className="font-preview-sample"
                        style={{
                          fontFamily:
                            currentStyle.fontFamily ??
                            HYDRA_FONT_PRESETS[0].family,
                        }}
                      >
                        Aa — Hydra Theme Editor
                      </div>
                      <InspectorField
                        label="Estilo"
                        value={currentStyle.fontStyle ?? "normal"}
                        onChange={(v) => updateStyle({ fontStyle: v })}
                        placeholder="normal / italic / oblique"
                      />
                      <InspectorField
                        label="Altura da linha"
                        value={currentStyle.lineHeight ?? "normal"}
                        onChange={(v) => updateStyle({ lineHeight: v })}
                        placeholder="1.4 / 20px"
                      />
                      <InspectorField
                        label="Transformação"
                        value={currentStyle.textTransform ?? "none"}
                        onChange={(v) => updateStyle({ textTransform: v })}
                        placeholder="none / uppercase / lowercase"
                      />
                      <RangeField
                        label="Peso"
                        value={Number(currentStyle.fontWeight ?? 400)}
                        suffix=""
                        min={100}
                        max={900}
                        step={100}
                        onChange={(v) => updateStyle({ fontWeight: v })}
                      />
                      <RangeField
                        label="Tamanho"
                        value={Number(currentStyle.fontSize ?? 16)}
                        suffix="px"
                        min={8}
                        max={72}
                        onChange={(v) => updateStyle({ fontSize: v })}
                      />
                      <RangeField
                        label="Espaçamento"
                        value={Number(currentStyle.letterSpacing ?? 0)}
                        suffix="px"
                        min={-3}
                        max={12}
                        step={0.5}
                        onChange={(v) => updateStyle({ letterSpacing: v })}
                      />
                    </div>
                  )}
                  <InspectorField
                    label="Cor de fundo"
                    value={currentStyle.backgroundColor ?? ""}
                    onChange={(v) => updateStyle({ backgroundColor: v })}
                    type="color"
                  />
                  <InspectorField
                    label="Cor do texto"
                    value={currentStyle.color ?? ""}
                    onChange={(v) => updateStyle({ color: v })}
                    type="color"
                  />
                  <InspectorField
                    label="Imagem de fundo"
                    value={currentStyle.backgroundImage ?? ""}
                    onChange={(v) => updateStyle({ backgroundImage: v })}
                    placeholder="url(...)"
                  />
                  <RangeField
                    label="Opacidade"
                    value={Number(currentStyle.opacity ?? 1) * 100}
                    suffix="%"
                    min={0}
                    max={100}
                    onChange={(v) => updateStyle({ opacity: v / 100 })}
                  />
                  <RangeField
                    label="Raio da borda"
                    value={Number(currentStyle.borderRadius ?? 0)}
                    suffix="px"
                    min={0}
                    max={50}
                    onChange={(v) => updateStyle({ borderRadius: v })}
                  />
                  <RangeField
                    label="Tamanho da fonte"
                    value={Number(currentStyle.fontSize ?? 16)}
                    suffix="px"
                    min={8}
                    max={72}
                    onChange={(v) => updateStyle({ fontSize: v })}
                  />
                  <div className="inspector-section">
                    <label>Família da fonte</label>
                    <select
                      className="wide-input"
                      value={currentStyle.fontFamily ?? "Noto Sans"}
                      onChange={(e) =>
                        updateStyle({ fontFamily: e.target.value })
                      }
                    >
                      {[
                        "Noto Sans",
                        "Inter",
                        "Roboto",
                        "Open Sans",
                        "Montserrat",
                        "Poppins",
                        "Space Grotesk",
                        "Rubik",
                        "Oswald",
                        "Lato",
                        "Nunito",
                        "Ubuntu",
                        "JetBrains Mono",
                        "Fira Code",
                        "Cascadia Code",
                        "Arial",
                        "Helvetica",
                        "Georgia",
                        "serif",
                        "sans-serif",
                        "monospace",
                      ].map((font) => (
                        <option key={font} value={font}>
                          {font}
                        </option>
                      ))}
                    </select>
                  </div>
                  <InspectorField
                    label="Estilo da fonte"
                    value={currentStyle.fontStyle ?? "normal"}
                    onChange={(v) => updateStyle({ fontStyle: v })}
                    placeholder="normal / italic"
                  />
                  <InspectorField
                    label="Altura da linha"
                    value={currentStyle.lineHeight ?? "normal"}
                    onChange={(v) => updateStyle({ lineHeight: v })}
                    placeholder="1.4 / 20px"
                  />
                  <InspectorField
                    label="Transformação do texto"
                    value={currentStyle.textTransform ?? "none"}
                    onChange={(v) => updateStyle({ textTransform: v })}
                    placeholder="none / uppercase"
                  />
                  <RangeField
                    label="Peso da fonte"
                    value={Number(currentStyle.fontWeight ?? 400)}
                    suffix=""
                    min={100}
                    max={900}
                    step={100}
                    onChange={(v) => updateStyle({ fontWeight: v })}
                  />
                  <RangeField
                    label="Espaçamento"
                    value={Number(currentStyle.letterSpacing ?? 0)}
                    suffix="px"
                    min={-3}
                    max={10}
                    step={0.5}
                    onChange={(v) => updateStyle({ letterSpacing: v })}
                  />
                </>
              )}
              {inspectorTab === "layout" && (
                <>
                  <InspectorField
                    label="Padding"
                    value={currentStyle.padding ?? ""}
                    onChange={(v) => updateStyle({ padding: v })}
                    placeholder="12px 16px"
                  />
                  <InspectorField
                    label="Margin"
                    value={currentStyle.margin ?? ""}
                    onChange={(v) => updateStyle({ margin: v })}
                    placeholder="0 8px"
                  />
                  <RangeField
                    label="Gap"
                    value={Number(currentStyle.gap ?? 0)}
                    suffix="px"
                    min={0}
                    max={80}
                    onChange={(v) => updateStyle({ gap: v })}
                  />
                  <RangeField
                    label="Largura da borda"
                    value={Number(currentStyle.borderWidth ?? 0)}
                    suffix="px"
                    min={0}
                    max={20}
                    onChange={(v) => updateStyle({ borderWidth: v })}
                  />
                  <InspectorField
                    label="Transform"
                    value={currentStyle.transform ?? ""}
                    onChange={(v) => updateStyle({ transform: v })}
                    placeholder="scale(1.02)"
                  />
                </>
              )}
              {inspectorTab === "effects" && (
                <>
                  <InspectorField
                    label="Box Shadow"
                    value={currentStyle.boxShadow ?? ""}
                    onChange={(v) => updateStyle({ boxShadow: v })}
                    placeholder="0 8px 24px #0008"
                  />
                  <InspectorField
                    label="Backdrop Filter"
                    value={currentStyle.backdropFilter ?? ""}
                    onChange={(v) => updateStyle({ backdropFilter: v })}
                    placeholder="blur(12px)"
                  />
                  <InspectorField
                    label="Filter"
                    value={currentStyle.filter ?? ""}
                    onChange={(v) => updateStyle({ filter: v })}
                    placeholder="brightness(1.1)"
                  />
                  <InspectorField
                    label="Transition"
                    value={currentStyle.transition ?? ""}
                    onChange={(v) => updateStyle({ transition: v })}
                    placeholder="all .2s ease"
                  />
                </>
              )}
              {inspectorTab === "advanced" && (
                <>
                  <InspectorField
                    label="Background Size"
                    value={currentStyle.backgroundSize ?? ""}
                    onChange={(v) => updateStyle({ backgroundSize: v })}
                    placeholder="cover"
                  />
                  <InspectorField
                    label="Background Position"
                    value={currentStyle.backgroundPosition ?? ""}
                    onChange={(v) => updateStyle({ backgroundPosition: v })}
                    placeholder="center"
                  />
                  <InspectorField
                    label="Background Repeat"
                    value={currentStyle.backgroundRepeat ?? ""}
                    onChange={(v) => updateStyle({ backgroundRepeat: v })}
                    placeholder="no-repeat"
                  />
                  <div className="inspector-section">
                    <label>Propriedades CSS detectadas</label>
                    <div className="custom-properties-list">
                      {Object.entries(currentStyle.customProperties ?? {}).map(
                        ([property, value]) => (
                          <div className="custom-property-row" key={property}>
                            <code>{property}</code>
                            <input
                              className="wide-input"
                              value={value}
                              onChange={(e) =>
                                updateCustomProperty(property, e.target.value)
                              }
                            />
                          </div>
                        )
                      )}
                      {Object.keys(currentStyle.customProperties ?? {})
                        .length === 0 && (
                          <small>
                            Nenhuma propriedade adicional detectada neste
                            elemento.
                          </small>
                        )}
                    </div>
                  </div>
                  <div className="inspector-section">
                    <div className="section-heading-row">
                      <label>Variáveis CSS</label>
                      <button onClick={addVariable}>＋</button>
                    </div>
                    <div className="custom-properties-list">
                      {Object.entries(document.variables ?? {}).map(
                        ([name, value]) => (
                          <div className="custom-property-row" key={name}>
                            <code>{name}</code>
                            <input
                              className="wide-input"
                              value={value}
                              onChange={(e) =>
                                updateVariable(name, e.target.value)
                              }
                            />
                          </div>
                        )
                      )}
                      {Object.keys(document.variables ?? {}).length === 0 && (
                        <small>Nenhuma variável importada.</small>
                      )}
                    </div>
                  </div>
                  <div className="inspector-section">
                    <label>Condições detectadas</label>
                    <div className="condition-list">
                      {(
                        importChanges.find(
                          (c) =>
                            c.targetId === selectedTarget &&
                            c.state === selectedState
                        )?.conditions ??
                        document.conditions ??
                        []
                      ).map((condition, index) => (
                        <code key={`${condition}-${index}`}>{condition}</code>
                      ))}
                      {!document.conditions?.length && (
                        <small>Nenhuma condição detectada.</small>
                      )}
                    </div>
                  </div>
                  <div className="inspector-section">
                    <label>Estado / condição</label>
                    <select
                      className="wide-input"
                      value={selectedState}
                      onChange={(e) =>
                        setSelectedState(e.target.value as EditorState)
                      }
                    >
                      {STATES.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <div className="inspector-section">
                <label>Textura / Overlay</label>
                <div className="layer-actions">
                  <button onClick={addLayer}>＋ Nova camada</button>
                </div>
                {document.layers
                  .filter((layer) => layer.targetId === selectedTarget)
                  .map((layer) => (
                    <div className="layer-card" key={layer.id}>
                      <div className="layer-card__header">
                        <strong>{layer.name}</strong>
                        <button
                          className="layer-delete"
                          title="Remover camada"
                          onClick={() => removeLayer(layer.id)}
                        >
                          ×
                        </button>
                      </div>
                      <input
                        value={layer.image}
                        onChange={(e) =>
                          updateLayer(layer.id, { image: e.target.value })
                        }
                      />
                      <RangeField
                        label="Opacidade"
                        value={layer.opacity * 100}
                        suffix="%"
                        min={0}
                        max={100}
                        onChange={(v) =>
                          updateLayer(layer.id, { opacity: v / 100 })
                        }
                      />
                      <select
                        value={layer.blendMode}
                        onChange={(e) =>
                          updateLayer(layer.id, { blendMode: e.target.value })
                        }
                      >
                        {[
                          "normal",
                          "multiply",
                          "screen",
                          "overlay",
                          "soft-light",
                          "hard-light",
                          "difference",
                        ].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                  ))}
              </div>
            </aside>
          </main>
        </>
      )}

      <footer className="theme-editor-pro__footer">
        <span>
          Tema: <strong>{theme?.name ?? "Novo Tema"}</strong>
        </span>
        <span className="footer-status">
          {hasUnsavedChanges ? "● Alterações não salvas" : "● Tudo salvo"}
        </span>
        <span>
          CSS visual: {document.rules.length} regras · Camadas:{" "}
          {document.layers.length}
        </span>
      </footer>
    </div>
  );
}

function InspectorField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "color";
  placeholder?: string;
}) {
  return (
    <div className="inspector-section">
      <label>{label}</label>
      <div className="field-row">
        {type === "color" && (
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        <input
          className="wide-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}

function RangeField({
  label,
  value,
  suffix,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  suffix: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="range-field">
      <div>
        <label>{label}</label>
        <output>
          {value.toFixed(step < 1 ? 1 : 0)}
          {suffix}
        </output>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}