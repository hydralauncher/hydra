import { useCallback, useState } from "react";
import {
  ImageIcon,
  FileZipIcon,
  XIcon,
  LinkExternalIcon,
} from "@primer/octicons-react";
import { Modal, Button, TextField } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import { useLibrary } from "@renderer/hooks/use-library";
import "./add-custom-game-modal.scss";

type AssetKey = "cover" | "logo" | "hero";

interface LargeAssetField {
  readonly label: string;
  readonly key: "cover" | "logo" | "hero";
  readonly hint: string;
  readonly ratio: string;
  readonly aspect: string;
}

const LARGE_ASSET_FIELDS: readonly LargeAssetField[] = [
  {
    label: "Capa",
    key: "cover",
    hint: "Vertical — tela inicial e detalhes",
    ratio: "2:3",
    aspect: "2 / 3",
  },
  {
    label: "Logo",
    key: "logo",
    hint: "Transparente — home e detalhes",
    ratio: "Auto (Recomendado 21:9)",
    aspect: "21 / 9",
  },
  {
    label: "Hero / Background",
    key: "hero",
    hint: "Arte de fundo da tela do jogo",
    ratio: "16:6",
    aspect: "16 / 6",
  },
] as const;

interface AssetState {
  cover: string | null;
  logo: string | null;
  hero: string | null;
}

interface AddCustomGameModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
}

export function AddCustomGameModal({
  visible,
  onClose,
}: AddCustomGameModalProps): JSX.Element {
  const [title, setTitle] = useState("");
  const [executablePath, setExecutablePath] = useState("");
  const [previews, setPreviews] = useState<AssetState>({
    cover: null,
    logo: null,
    hero: null,
  });
  const [assetPaths, setAssetPaths] = useState<AssetState>({
    cover: null,
    logo: null,
    hero: null,
  });
  const [isSaving, setIsSaving] = useState(false);

  const { showSuccessToast, showErrorToast } = useToast();
  const { updateLibrary } = useLibrary();

  const handleClose = useCallback(() => {
    if (isSaving) return;
    setTitle("");
    setExecutablePath("");
    setPreviews({ cover: null, logo: null, hero: null });
    setAssetPaths({ cover: null, logo: null, hero: null });
    onClose();
  }, [isSaving, onClose]);

  const handleOpenSteamGridDB = useCallback(() => {
    const query = title.trim()
      ? `https://www.steamgriddb.com/search/grids?term=${encodeURIComponent(title.trim())}`
      : "https://www.steamgriddb.com";
    void window.electron.openExternal(query);
  }, [title]);

  const handlePickExecutable = useCallback(async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: "Executáveis", extensions: ["exe", "bat", "sh", "AppImage"] },
        { name: "Todos os Arquivos", extensions: ["*"] },
      ],
    });

    if (!filePaths || filePaths.length === 0) return;
    const p = filePaths[0];
    setExecutablePath(p);

    if (!title) {
      const parts = p.replace(/\\/g, "/").split("/");
      const fileName = parts[parts.length - 1];
      setTitle(fileName.replace(/\.[^.]+$/, ""));
    }
  }, [title]);

  const handlePickImage = useCallback(async (assetKey: AssetKey) => {
    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: "Imagens",
          extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif", "ico"],
        },
      ],
    });

    if (!filePaths || filePaths.length === 0) return;

    const sourcePath = filePaths[0];

    // The app registers a custom "local:" protocol in main/index.ts that serves
    // local files — use it directly in <img src> for instant synchronous preview.
    const previewUrl = `local:${sourcePath}`;

    setPreviews((prev) => ({ ...prev, [assetKey]: previewUrl }));
    setAssetPaths((prev) => ({ ...prev, [assetKey]: sourcePath }));
  }, []);

  const handleRemoveImage = useCallback((assetKey: AssetKey) => {
    setPreviews((prev) => ({ ...prev, [assetKey]: null }));
    setAssetPaths((prev) => ({ ...prev, [assetKey]: null }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!title.trim() || !executablePath.trim()) {
      showErrorToast("Nome e executável são obrigatórios.");
      return;
    }

    setIsSaving(true);
    try {
      const copyAsset = async (
        key: AssetKey,
        assetType: "icon" | "logo" | "hero" | "grid"
      ): Promise<string | undefined> => {
        const p = assetPaths[key];
        if (!p) return undefined;
        // If it's a base64 string (like the extracted executable icon), we don't save it as a local file,
        // we just store the base64 string directly in the database.
        if (p.startsWith("data:")) return p;
        return window.electron.copyCustomGameAsset(p, assetType);
      };

      const [coverUrl, logoUrl, heroUrl] = await Promise.all([
        copyAsset("cover", "grid"),
        copyAsset("logo", "logo"),
        copyAsset("hero", "hero"),
      ]);

      await window.electron.addCustomGameToLibrary(
        title.trim(),
        executablePath.trim(),
        coverUrl,
        logoUrl,
        heroUrl
      );

      await updateLibrary();
      showSuccessToast(`"${title.trim()}" adicionado à biblioteca!`);
      handleClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Erro ao adicionar o jogo.";
      showErrorToast(
        msg.includes("already exists")
          ? "Este executável já está na biblioteca."
          : msg
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    title,
    executablePath,
    assetPaths,
    updateLibrary,
    showSuccessToast,
    showErrorToast,
    handleClose,
  ]);

  return (
    <Modal
      visible={visible}
      title="Adicionar Jogo Personalizado"
      description="Adicione jogos que não estão no catálogo da Hydra."
      onClose={handleClose}
    >
      <div className="add-custom-game">
        {/* Fields: title + executable */}
        <div className="add-custom-game__fields">
          <TextField
            label="Nome do Jogo"
            placeholder="Ex: Need for Speed Underground 2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isSaving}
          />

          <div className="add-custom-game__executable">
            <label className="add-custom-game__label" htmlFor="exec-path-input">
              Executável
            </label>
            <div className="add-custom-game__executable-row">
              <input
                id="exec-path-input"
                type="text"
                className="add-custom-game__path-input"
                placeholder="Caminho do executável..."
                value={executablePath}
                readOnly
                aria-label="Caminho do executável"
              />
              <Button
                theme="outline"
                onClick={handlePickExecutable}
                disabled={isSaving}
              >
                <FileZipIcon size={14} />
                Escolher
              </Button>
            </div>
          </div>
        </div>

        {/* Assets section */}
        <div className="add-custom-game__assets-section">
          <div className="add-custom-game__assets-header">
            <span className="add-custom-game__assets-title">Artes do Jogo</span>
            <button
              type="button"
              className="add-custom-game__steamgriddb-btn"
              onClick={handleOpenSteamGridDB}
              title={
                title.trim()
                  ? `Buscar "${title.trim()}" no SteamGridDB`
                  : "Abrir SteamGridDB"
              }
            >
              <LinkExternalIcon size={13} />
              {title.trim() ? `Buscar "${title.trim()}"` : "SteamGridDB"}
            </button>
          </div>

          {/* Main layout: vertical cover left + banner/hero stacked right */}
          <div className="add-custom-game__assets-layout">
            {/* Vertical cover — tall portrait */}
            <div className="add-custom-game__asset-slot">
              <div
                className="add-custom-game__asset-preview add-custom-game__asset-preview--cover"
                role="button"
                tabIndex={0}
                aria-label="Selecionar Capa"
                onClick={() => !isSaving && handlePickImage("cover")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ")
                    handlePickImage("cover");
                }}
              >
                {previews.cover ? (
                  <>
                    <img
                      src={previews.cover}
                      alt="Capa"
                      className="add-custom-game__asset-img"
                    />
                    <button
                      type="button"
                      className="add-custom-game__asset-remove"
                      aria-label="Remover Capa"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveImage("cover");
                      }}
                    >
                      <XIcon size={12} />
                    </button>
                  </>
                ) : (
                  <div className="add-custom-game__asset-empty">
                    <ImageIcon size={20} />
                    <span className="add-custom-game__asset-ratio">2:3</span>
                  </div>
                )}
              </div>
              <span className="add-custom-game__asset-label">
                Capa Vertical
              </span>
              <span className="add-custom-game__asset-hint">
                Tela inicial e detalhes
              </span>
            </div>

            {/* Logo + Hero stacked */}
            <div className="add-custom-game__assets-stack">
              {LARGE_ASSET_FIELDS.filter(
                (f) => f.key === "logo" || f.key === "hero"
              ).map(({ label, key, hint, ratio, aspect }) => (
                <div key={key} className="add-custom-game__asset-slot">
                  <div
                    className="add-custom-game__asset-preview"
                    style={{ aspectRatio: aspect }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Selecionar ${label}`}
                    onClick={() => !isSaving && handlePickImage(key)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ")
                        handlePickImage(key);
                    }}
                  >
                    {previews[key] ? (
                      <>
                        <img
                          src={previews[key]!}
                          alt={label}
                          className="add-custom-game__asset-img"
                        />
                        <button
                          type="button"
                          className="add-custom-game__asset-remove"
                          aria-label={`Remover ${label}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveImage(key);
                          }}
                        >
                          <XIcon size={12} />
                        </button>
                      </>
                    ) : (
                      <div className="add-custom-game__asset-empty">
                        <ImageIcon size={16} />
                        <span className="add-custom-game__asset-ratio">
                          {ratio}
                        </span>
                      </div>
                    )}
                  </div>
                  <span className="add-custom-game__asset-label">{label}</span>
                  <span className="add-custom-game__asset-hint">{hint}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="add-custom-game__actions">
          <Button theme="outline" onClick={handleClose} disabled={isSaving}>
            Cancelar
          </Button>
          <Button
            theme="primary"
            onClick={handleSave}
            disabled={isSaving || !title.trim() || !executablePath.trim()}
          >
            {isSaving ? "Adicionando..." : "Adicionar à Biblioteca"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
