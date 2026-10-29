import "./styles.scss";

import cn from "classnames";
import xboxButtonX from "../../../assets/xbox-button-x.svg?url";

const GLYPHS = {
  X: xboxButtonX,
};

interface ControllerButtonGlyphProps {
  button: keyof typeof GLYPHS;
  className?: string;
}

export function ControllerButtonGlyph({
  button,
  className,
}: Readonly<ControllerButtonGlyphProps>) {
  return (
    <span
      className={cn("controller-button-glyph", className)}
      aria-hidden="true"
    >
      <span className="controller-button-glyph__group">
        <img
          className="controller-button-glyph__image"
          src={GLYPHS[button]}
          alt=""
          draggable={false}
        />
      </span>
    </span>
  );
}
