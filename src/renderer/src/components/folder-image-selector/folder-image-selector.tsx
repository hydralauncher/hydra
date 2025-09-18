import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@renderer/hooks";
import { Button } from "@renderer/components";
import {
  FileDirectoryIcon,
  DeviceDesktopIcon,
  ZapIcon,
  LocationIcon,
  RocketIcon,
  TrophyIcon,
  ProjectIcon,
  FlameIcon,
  EyeClosedIcon,
  PulseIcon,
  ToolsIcon,
  CircleIcon,
  PeopleIcon,
  PersonIcon,
  DeviceCameraVideoIcon,
  StarIcon,
} from "@primer/octicons-react";
import "./folder-image-selector.scss";

export interface FolderImageSelectorProps {
  selectedImage?: string;
  selectedIcon?: string;
  onImageChange: (image: string | undefined) => void;
  onIconChange: (icon: string | undefined) => void;
}

// Ícones pré-definidos disponíveis
const PREDEFINED_ICONS = [
  {
    id: "folder",
    icon: <FileDirectoryIcon size={24} />,
    name: "Pasta",
  },
  {
    id: "games",
    icon: <DeviceDesktopIcon size={24} />,
    name: "Jogos",
  },
  {
    id: "action",
    icon: <ZapIcon size={24} />,
    name: "Ação",
  },
  {
    id: "adventure",
    icon: <LocationIcon size={24} />,
    name: "Aventura",
  },
  {
    id: "racing",
    icon: <RocketIcon size={24} />,
    name: "Corrida",
  },
  {
    id: "sports",
    icon: <TrophyIcon size={24} />,
    name: "Esportes",
  },
  {
    id: "strategy",
    icon: <ProjectIcon size={24} />,
    name: "Estratégia",
  },
  {
    id: "rpg",
    icon: <FlameIcon size={24} />,
    name: "RPG",
  },
  {
    id: "horror",
    icon: <EyeClosedIcon size={24} />,
    name: "Terror",
  },
  {
    id: "puzzle",
    icon: <PulseIcon size={24} />,
    name: "Puzzle",
  },
  {
    id: "simulation",
    icon: <ToolsIcon size={24} />,
    name: "Simulação",
  },
  {
    id: "indie",
    icon: <CircleIcon size={24} />,
    name: "Indie",
  },
  {
    id: "multiplayer",
    icon: <PeopleIcon size={24} />,
    name: "Multiplayer",
  },
  {
    id: "singleplayer",
    icon: <PersonIcon size={24} />,
    name: "Singleplayer",
  },
  {
    id: "retro",
    icon: <DeviceCameraVideoIcon size={24} />,
    name: "Retro",
  },
  {
    id: "favorite",
    icon: <StarIcon size={24} />,
    name: "Favoritos",
  },
];

export function FolderImageSelector({
  selectedImage,
  selectedIcon,
  onImageChange,
  onIconChange,
}: FolderImageSelectorProps) {
  const { t } = useTranslation("games_folder");
  const { showErrorToast } = useToast();
  const [activeTab, setActiveTab] = useState<"icons" | "upload">("icons");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleIconSelect = (iconId: string) => {
    onIconChange(iconId);
    onImageChange(undefined); // Limpar imagem personalizada quando selecionar ícone
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Verificar formatos aceitos (PNG, JPG, JPEG, ICO, SVG)
      const allowedTypes = [
        "image/png",
        "image/jpg",
        "image/jpeg",
        "image/x-icon",
        "image/vnd.microsoft.icon",
        "image/svg+xml",
      ];

      if (!allowedTypes.includes(file.type)) {
        showErrorToast(t("image_type_error_title"), t("image_type_error"));
        return;
      }

      // Verificar tamanho (máximo 3MB)
      if (file.size > 3 * 1024 * 1024) {
        showErrorToast(t("image_size_error_title"), t("image_size_error"));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;

        // Criar uma imagem temporária para verificar as dimensões
        const img = new Image();
        img.onload = () => {
          // Verificar se a resolução é maior que 512x512
          if (img.width > 512 || img.height > 512) {
            showErrorToast(
              t("image_resolution_error_title"),
              t("image_resolution_details", {
                currentWidth: img.width,
                currentHeight: img.height,
                maxWidth: 512,
                maxHeight: 512,
              })
            );
            // Limpar o input para permitir nova seleção
            if (event.target) {
              event.target.value = "";
            }
            return;
          }

          // Se passou em todas as validações, aplicar a imagem
          onImageChange(result);
          onIconChange(undefined); // Limpar ícone quando selecionar imagem
        };

        img.onerror = () => {
          alert(t("image_load_error"));
          if (event.target) {
            event.target.value = "";
          }
        };

        img.src = result;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemoveImage = () => {
    onImageChange(undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="folder-image-selector">
      <div className="folder-image-selector__tabs">
        <button
          type="button"
          className={`folder-image-selector__tab ${
            activeTab === "icons" ? "folder-image-selector__tab--active" : ""
          }`}
          onClick={() => setActiveTab("icons")}
        >
          🎨 {t("icons")}
        </button>
        <button
          type="button"
          className={`folder-image-selector__tab ${
            activeTab === "upload" ? "folder-image-selector__tab--active" : ""
          }`}
          onClick={() => setActiveTab("upload")}
        >
          📷 {t("custom_image")}
        </button>
      </div>

      <div className="folder-image-selector__content">
        {activeTab === "icons" && (
          <div className="folder-image-selector__icons">
            <div className="folder-image-selector__icons-grid">
              {PREDEFINED_ICONS.map((icon) => (
                <button
                  key={icon.id}
                  type="button"
                  className={`folder-image-selector__icon-button ${
                    selectedIcon === icon.id
                      ? "folder-image-selector__icon-button--selected"
                      : ""
                  }`}
                  onClick={() => handleIconSelect(icon.id)}
                  title={icon.name}
                >
                  <span className="folder-image-selector__icon-svg">
                    {icon.icon}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTab === "upload" && (
          <div className="folder-image-selector__upload">
            {selectedImage ? (
              <div className="folder-image-selector__preview">
                <img
                  src={selectedImage}
                  alt="Preview"
                  className="folder-image-selector__preview-image"
                />
                <div className="folder-image-selector__preview-actions">
                  <Button theme="outline" onClick={handleUploadClick}>
                    {t("change_image")}
                  </Button>
                  <Button theme="danger" onClick={handleRemoveImage}>
                    {t("remove")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="folder-image-selector__upload-area">
                <div className="folder-image-selector__upload-content">
                  <span className="folder-image-selector__upload-icon">📷</span>
                  <p className="folder-image-selector__upload-text">
                    {t("click_to_select_image")}
                  </p>
                  <p className="folder-image-selector__upload-hint">
                    {t("supported_formats")}
                  </p>
                  <Button theme="outline" onClick={handleUploadClick}>
                    {t("select_image")}
                  </Button>
                </div>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.ico,.svg,.png"
              onChange={handleImageUpload}
              style={{ display: "none" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
