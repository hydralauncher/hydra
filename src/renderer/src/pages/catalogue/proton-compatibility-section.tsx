import { ChevronDownIcon } from "@primer/octicons-react";
import { useEffect, useRef, useState } from "react";
import { CheckboxField } from "@renderer/components/checkbox-field/checkbox-field";
import { RadioField } from "@renderer/components/radio-field/radio-field";

import "./proton-compatibility-section.scss";

interface ProtonCompatibilitySectionProps {
  title: string;
  protonSliderLabel: string;
  deckSliderLabel: string;
  protonOptions: { value: string; label: string; color?: string }[];
  protonValue: string;
  deckChecked: boolean;
  deckLabel: string;
  color: string;
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
  color,
  onProtonChange,
  onDeckChange,
}: ProtonCompatibilitySectionProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [height, setHeight] = useState(0);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (content.current) {
      setHeight(isOpen ? content.current.scrollHeight : 0);
    }
  }, [isOpen, protonValue, deckChecked]);

  return (
    <div className="filter-section proton-compatibility-section">
      <button
        type="button"
        className="filter-section__button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        <ChevronDownIcon
          className={`filter-section__chevron ${
            isOpen ? "filter-section__chevron--open" : ""
          }`}
        />

        <div className="filter-section__header">
          <div
            className="filter-section__orb"
            style={{ backgroundColor: color }}
          />
          <h3 className="filter-section__title">{title}</h3>
        </div>
      </button>

      <div
        ref={content}
        className="filter-section__content"
        style={{ maxHeight: `${height}px` }}
      >
        <div className="filter-section__content-inner proton-compatibility-section__content-inner">
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
            <span className="proton-compatibility-section__label">
              {deckSliderLabel}
            </span>

            <CheckboxField
              label={deckLabel}
              checked={deckChecked}
              onChange={(event) => onDeckChange(event.target.checked)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
