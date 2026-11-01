import { ChevronDownIcon } from "@primer/octicons-react";
import { useEffect, useRef, useState } from "react";
import { RadioField } from "@renderer/components/radio-field/radio-field";
import type { RecompilationFilter } from "@renderer/features";

import "./filter.scss";
import "./recompilation-filter-section.scss";

interface RecompilationFilterSectionProps {
  title: string;
  color: string;
  value: RecompilationFilter;
  options: { value: RecompilationFilter; label: string }[];
  onChange: (value: RecompilationFilter) => void;
}

/** Built like ProtonCompatibilitySection: the filter-section shell plus RadioField. */
export function RecompilationFilterSection({
  title,
  color,
  value,
  options,
  onChange,
}: Readonly<RecompilationFilterSectionProps>) {
  const [isOpen, setIsOpen] = useState(true);
  const [height, setHeight] = useState(0);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (content.current) {
      setHeight(isOpen ? content.current.scrollHeight : 0);
    }
  }, [isOpen, value]);

  return (
    <div className="filter-section recompilation-filter-section">
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
        <div
          className="filter-section__content-inner recompilation-filter-section__option-list"
          role="radiogroup"
          aria-label={title}
        >
          {options.map((option) => (
            <div key={option.value}>
              <RadioField
                name="recompilation-filter"
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                className="recompilation-filter-section__option-item"
                labelClassName="recompilation-filter-section__option-label"
                label={option.label}
                aria-label={option.label}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
