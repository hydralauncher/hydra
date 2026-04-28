import "./styles.scss";

import { Backdrop } from "../backdrop";

export interface ImageLightboxProps {
  src: string;
  alt: string;
}

export function ImageLightbox({ src, alt }: Readonly<ImageLightboxProps>) {
  return (
    <Backdrop>
      <img src={src} alt={alt} className="image-lightbox" draggable={false} />
    </Backdrop>
  );
}
