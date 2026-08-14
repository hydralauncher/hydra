import type { ReactNode } from "react";

interface MacCompatibilityPanelProps {
  gameName?: string;
  gameIcon?: ReactNode;
}

export function MacCompatibilityPanel({
  gameName = "Game",
  gameIcon,
}: MacCompatibilityPanelProps) {
  return (
    <div
      style={{
        minHeight: "100%",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a0a",
        color: "#ffffff",
        padding: "32px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "720px",
          borderRadius: "20px",
          background: "#111111",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
          padding: "32px",
          boxSizing: "border-box",
        }}
      >
        {/* Hydra logo */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            marginBottom: "28px",
          }}
        >
          <div
            aria-label="Hydra logo placeholder"
            style={{
              width: "76px",
              height: "76px",
              borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "28px",
              fontWeight: 700,
              letterSpacing: "-2px",
            }}
          >
            H
          </div>
        </div>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <div
            style={{
              fontSize: "13px",
              fontWeight: 600,
              letterSpacing: "2px",
              textTransform: "uppercase",
              opacity: 0.55,
              marginBottom: "8px",
            }}
          >
            Mac Compatibility
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: "30px",
              fontWeight: 700,
              letterSpacing: "-0.8px",
            }}
          >
            {gameName}
          </h1>
        </div>

        {/* Game / compatibility status */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            padding: "18px",
            borderRadius: "14px",
            background: "#181818",
            border: "1px solid rgba(255,255,255,0.06)",
            marginBottom: "20px",
          }}
        >
          {gameIcon ? (
            <div
              style={{
                width: "52px",
                height: "52px",
                flexShrink: 0,
                borderRadius: "10px",
                overflow: "hidden",
              }}
            >
              {gameIcon}
            </div>
          ) : (
            <div
              style={{
                width: "52px",
                height: "52px",
                flexShrink: 0,
                borderRadius: "10px",
                background: "#242424",
              }}
            />
          )}

          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: "12px",
                textTransform: "uppercase",
                letterSpacing: "1px",
                opacity: 0.5,
                marginBottom: "4px",
              }}
            >
              Compatibility Status
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "16px",
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  width: "9px",
                  height: "9px",
                  borderRadius: "50%",
                  background: "#4ade80",
                  boxShadow: "0 0 10px rgba(74,222,128,0.6)",
                }}
              />

              Ready to test
            </div>
          </div>
        </div>

        {/* Wine information */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12px",
            marginBottom: "24px",
          }}
        >
          <InfoCard label="Wine Version" value="Not selected" />

          <InfoCard label="Environment" value="Not created" />
        </div>

        {/* Actions */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <ActionButton primary>Test Setup</ActionButton>

          <ActionButton>Fix Everything</ActionButton>

          <ActionButton>Repair</ActionButton>
        </div>

        {/* Future diagnostics area */}
        <div
          style={{
            marginTop: "24px",
            paddingTop: "20px",
            borderTop: "1px solid rgba(255,255,255,0.07)",
            fontSize: "12px",
            lineHeight: 1.6,
            opacity: 0.45,
            textAlign: "center",
          }}
        >
          Compatibility diagnostics and environment history will appear here.
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "16px",
        borderRadius: "12px",
        background: "#151515",
        border: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <div
        style={{
          fontSize: "11px",
          textTransform: "uppercase",
          letterSpacing: "0.8px",
          opacity: 0.45,
          marginBottom: "6px",
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize: "14px",
          fontWeight: 600,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ActionButton({
  children,
  primary = false,
}: {
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      style={{
        width: "100%",
        border: primary
          ? "1px solid rgba(255,255,255,0.25)"
          : "1px solid rgba(255,255,255,0.08)",
        borderRadius: "12px",
        padding: "14px 18px",
        background: primary ? "#ffffff" : "#181818",
        color: primary ? "#000000" : "#ffffff",
        fontSize: "14px",
        fontWeight: 650,
        cursor: "pointer",
        transition: "transform 120ms ease, opacity 120ms ease",
      }}
    >
      {children}
    </button>
  );
}
