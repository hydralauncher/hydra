import "./animated-border.scss";
import { BorderBeam } from "../ui/border-beam";
import ElectricBorder from "../ui/electric-border";
import { isGifDecoration, getDecorationUrl } from "./avatar-decorations";

// Open string type — actual valid values come from avatar-decorations.ts catalog
export type BorderStyle = string;

interface AnimatedBorderProps {
  children: React.ReactNode;
  borderClass?: string;
  styleName?: BorderStyle;
  borderWidth?: number;
  beamSpeed?: number;
  beamColor?: string;
  beamLength?: number;
  beamChaos?: number;
  containerSize?: number;
}

export function AnimatedBorder({
  children,
  borderClass = "",
  styleName = "none",
  borderWidth = 1,
  beamSpeed = 6,
  beamColor = "#ef4444",
  beamLength = 25,
  beamChaos = 0.12,
  containerSize,
}: Readonly<AnimatedBorderProps>) {
  if (styleName === "none") {
    return (
      <div className={`animated-border-wrapper ${borderClass}`}>{children}</div>
    );
  }

  const bSize = containerSize ? containerSize * 2 : 300;
  const eDisplacement = containerSize ? containerSize * 0.25 : 30;
  const eOffset = containerSize ? containerSize * 0.25 : 30;
  const gifUrl = isGifDecoration(styleName)
    ? getDecorationUrl(styleName)
    : null;

  return (
    <div className={`animated-border-wrapper ${borderClass}`}>
      {/* Beam / electric border layer — behind content */}
      {(styleName === "border-beam" || styleName === "electric-border") && (
        <div
          style={{
            position: "absolute",
            inset: `-${borderWidth}px`,
            borderRadius: "50%",
            zIndex: 1,
            pointerEvents: "none",
          }}
        >
          {styleName === "border-beam" && (
            <BorderBeam
              size={bSize}
              duration={beamSpeed}
              colorFrom="transparent"
              colorTo={beamColor}
              borderWidth={borderWidth}
              beamLength={beamLength}
            />
          )}
          {styleName === "electric-border" && (
            <ElectricBorder
              color={beamColor}
              speed={beamSpeed}
              chaos={beamChaos}
              borderRadius="50%"
              displacement={eDisplacement}
              borderOffset={eOffset}
              style={{ width: "100%", height: "100%" }}
            />
          )}
        </div>
      )}

      {/* Avatar content */}
      <div className="animated-border-content">{children}</div>

      {/* GIF decoration overlay — WebP HD with transparency */}
      {gifUrl && (
        <img
          src={gifUrl}
          alt="avatar decoration"
          style={{
            position: "absolute",
            width: "120%",
            height: "120%",
            top: "-10%",
            left: "-10%",
            objectFit: "contain",
            pointerEvents: "none",
            userSelect: "none",
            zIndex: 3,
          }}
        />
      )}
    </div>
  );
}
