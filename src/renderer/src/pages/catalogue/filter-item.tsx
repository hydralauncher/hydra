import { vars } from "@renderer/theme.css";
import { XIcon } from "@primer/octicons-react";

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
        color: vars.color.body,
        backgroundColor: vars.color.darkBackground,
        padding: "6px 12px",
        borderRadius: 4,
        border: `solid 1px ${vars.color.border}`,
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
          color: vars.color.body,
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
