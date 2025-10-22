import { SearchIcon } from "@primer/octicons-react";
import { FC, useRef } from "react";
import { useTranslation } from "react-i18next";
import "./search-bar.scss";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export const SearchBar: FC<SearchBarProps> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClear = () => {
    onChange("");
    inputRef.current?.focus();
  };

  return (
    <div className="search-bar">
      <div className="search-bar__container">
        <SearchIcon size={16} className="search-bar__icon" />
        <input
          ref={inputRef}
          type="text"
          className="search-bar__input"
          placeholder={t("Search library", { defaultValue: "Search library" })}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {value && (
          <button
            className="search-bar__clear"
            onClick={handleClear}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
};
