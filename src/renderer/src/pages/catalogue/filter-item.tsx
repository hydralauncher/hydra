import { XIcon } from "@primer/octicons-react";
import "../../scss/_variables.scss";

interface FilterItemProps {
  filter: string;
  orbColor: string;
  onRemove: () => void;
}

export function FilterItem({ filter, orbColor, onRemove }: FilterItemProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        color: "var(--body-color)",
        backgroundColor: "var(--dark-background-color",
        padding: "6px 12px",
        borderRadius: 4,
        border: `solid 1px var(--border-color)`,
        fontSize: 12,
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          backgroundColor: orbColor,
          borderRadius: "50%",
          marginRight: 8,
        }}
      />
      {filter}
      <button
        type="button"
        onClick={onRemove}
        style={{
          color: "var(--body-color)",
          marginLeft: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <XIcon size={13} />
      </button>
    </div>
  );
}
