import { useRef, useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FilterIcon, ChevronDownIcon, CheckIcon } from "@primer/octicons-react";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import SteamIcon from "@renderer/assets/launcher-icons/steam.svg?react";
import EpicGamesIcon from "@renderer/assets/launcher-icons/epic-games.svg?react";
import "./filter-options.scss";

export type PlatformTab = "all" | "hydra" | "steam" | "epic";

interface PlatformFilterProps {
  platform: PlatformTab;
  onPlatformChange: (platform: PlatformTab) => void;
}

export function PlatformFilter({
  platform,
  onPlatformChange,
}: Readonly<PlatformFilterProps>) {
  const { t } = useTranslation("library");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const options: { value: PlatformTab; icon?: React.ReactNode }[] = [
    { value: "all" },
    {
      value: "hydra",
      icon: (
        <HydraIcon style={{ width: 14, height: 14, fill: "currentColor" }} />
      ),
    },
    {
      value: "steam",
      icon: (
        <SteamIcon style={{ width: 14, height: 14, fill: "currentColor" }} />
      ),
    },
    {
      value: "epic",
      icon: (
        <EpicGamesIcon
          style={{ width: 14, height: 14, fill: "currentColor" }}
        />
      ),
    },
  ];

  const getLabel = (value: PlatformTab) => {
    switch (value) {
      case "hydra":
        return "Hydra";
      case "steam":
        return "Steam";
      case "epic":
        return "Epic Games";
      default:
        return t("all", { defaultValue: "Todos" });
    }
  };

  const handleSelect = useCallback(
    (value: PlatformTab) => {
      onPlatformChange(value);
      setOpen(false);
    },
    [onPlatformChange]
  );

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="library-filter-options" ref={containerRef}>
      <button
        type="button"
        className={`library-filter-options__trigger${open ? " library-filter-options__trigger--open" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <FilterIcon size={14} className="library-filter-options__icon" />
        <span className="library-filter-options__label">
          {getLabel(platform)}
        </span>
        <ChevronDownIcon
          size={12}
          className={`library-filter-options__chevron${open ? " library-filter-options__chevron--open" : ""}`}
        />
      </button>

      {open && (
        <ul
          className="library-filter-options__dropdown"
          role="listbox"
          aria-label={t("platform", { defaultValue: "Plataforma" })}
        >
          {options.map(({ value, icon }) => (
            <li
              key={value}
              role="option"
              aria-selected={platform === value}
              tabIndex={0}
              className={`library-filter-options__option${platform === value ? " library-filter-options__option--active" : ""}`}
              onClick={() => handleSelect(value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") handleSelect(value);
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {icon}
                <span>{getLabel(value)}</span>
              </div>
              {platform === value && (
                <CheckIcon
                  size={12}
                  className="library-filter-options__check"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
