import "./classics-spinner.scss";

const SEGMENTS = [
  { id: "a", color: "#fb0026" },
  { id: "b", color: "#c80078" },
  { id: "c", color: "#c80078" },
  { id: "d", color: "#7300a4" },
  { id: "e", color: "#7300a4" },
  { id: "f", color: "#f8c802" },
  { id: "g", color: "#fc5812" },
  { id: "h", color: "#fc5812" },
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
