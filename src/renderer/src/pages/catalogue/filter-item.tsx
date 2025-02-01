import { XIcon } from "@primer/octicons-react";
import "./filter.scss";

interface FilterItemProps {
  filter: string;
  orbColor: string;
  onRemove: () => void;
}

export function FilterItem({ filter, orbColor, onRemove }: FilterItemProps) {
  return (
    <div className="filter-item">
      <div className="filter-item__orb" style={{ backgroundColor: orbColor }} />
      {filter}
      <button
        type="button"
        onClick={onRemove}
        className="filter-item__remove-button"
      >
        <XIcon size={13} />
      </button>
    </div>
  );
}
