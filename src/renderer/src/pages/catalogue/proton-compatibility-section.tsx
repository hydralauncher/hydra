import { ChevronDownIcon } from "@primer/octicons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckboxField } from "@renderer/components/checkbox-field/checkbox-field";
import { RadioField } from "@renderer/components/radio-field/radio-field";
import SteamDeckLogo from "@renderer/assets/steam-deck-logo.svg?url";
import "./proton-compatibility-section.scss";

interface ProtonOption {
  value: string;
  label: string;
  color?: string;
}

interface ProtonCompatibilitySectionProps {
  title: string;
  protonSliderLabel: string;
  deckSliderLabel: string;
  protonOptions: ProtonOption[];
  protonValue: string;
  deckChecked: boolean;
  deckLabel: string;
  color?: string;
  icon?: React.ReactNode;
  onProtonChange: (value: string) => void;
  onDeckChange: (checked: boolean) => void;
}

export function ProtonCompatibilitySection({
  title,
  protonSliderLabel,
  deckSliderLabel,
  protonOptions,
  protonValue,
  deckChecked,
  deckLabel,
  icon,
  onProtonChange,
  onDeckChange,
}: Readonly<ProtonCompatibilitySectionProps>) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeCount = useMemo(
    () => (protonValue ? 1 : 0) + (deckChecked ? 1 : 0),
    [protonValue, deckChecked]
  );

  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (
      containerRef.current &&
      !containerRef.current.contains(event.target as Node)
    ) {
      setIsOpen(false);
    }
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape") setIsOpen(false);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleClickOutside, handleKeyDown]);

  return (
    <div className="filter-dropdown proton-dropdown" ref={containerRef}>
      <button
        type="button"
        className={`filter-dropdown__trigger ${
          isOpen ? "filter-dropdown__trigger--open" : ""
        } ${activeCount > 0 ? "filter-dropdown__trigger--active" : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        {icon && <span className="filter-dropdown__icon">{icon}</span>}
        <span className="filter-dropdown__title">{title}</span>
        {activeCount > 0 && (
          <span className="filter-dropdown__badge">{activeCount}</span>
        )}
        <ChevronDownIcon
          className={`filter-dropdown__chevron ${
            isOpen ? "filter-dropdown__chevron--open" : ""
          }`}
          size={12}
        />
      </button>

      {isOpen && (
        <div className="filter-dropdown__popover proton-compatibility-section__popover">
          <div className="proton-compatibility-section__control">
            <span className="proton-compatibility-section__label">
              {protonSliderLabel}
            </span>

            <div className="proton-compatibility-section__option-list">
              {protonOptions.map((option) => (
                <div key={option.value}>
                  <RadioField
                    name="protondb-tier-filter"
                    value={option.value}
                    checked={protonValue === option.value}
                    onChange={() => onProtonChange(option.value)}
                    onClick={(event) => {
                      if (protonValue === option.value) {
                        event.preventDefault();
                        onProtonChange("");
                      }
                    }}
                    className="proton-compatibility-section__option-item"
                    labelClassName="proton-compatibility-section__option-label"
                    label={option.label}
                    leftSlot={
                      <span
                        className="proton-compatibility-section__option-orb"
                        aria-hidden="true"
                        style={{
                          backgroundColor:
                            option.color ?? "rgba(255, 255, 255, 0.32)",
                        }}
                      />
                    }
                    aria-label={option.label}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="proton-compatibility-section__control">
            <span className="proton-compatibility-section__label proton-compatibility-section__label--deck">
              <img
                src={SteamDeckLogo}
                alt=""
                aria-hidden="true"
                className="proton-compatibility-section__deck-icon"
              />
              {deckSliderLabel}
            </span>

            <CheckboxField
              label={deckLabel}
              checked={deckChecked}
              onChange={(event) => onDeckChange(event.target.checked)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
