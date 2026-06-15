import "./classics-spinner.scss";

const SEGMENTS = [
  { id: "a", color: "#ffe978" },
  { id: "b", color: "#86cc83" },
  { id: "c", color: "#86cc83" },
  { id: "d", color: "#61c2ea" },
  { id: "e", color: "#61c2ea" },
  { id: "f", color: "#f6736a" },
  { id: "g", color: "#f5a46d" },
  { id: "h", color: "#f5a46d" },
];

interface Props {
  size?: number;
}

export function ClassicsSpinner({ size = 16 }: Readonly<Props>) {
  return (
    <span
      className="classics-spinner"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" width={size} height={size}>
        {SEGMENTS.map((segment, index) => (
          <rect
            key={segment.id}
            x="10.4"
            y="2"
            width="3.2"
            height="6.2"
            rx="1.6"
            fill={segment.color}
            transform={`rotate(${index * 45} 12 12)`}
          />
        ))}
      </svg>
    </span>
  );
}
