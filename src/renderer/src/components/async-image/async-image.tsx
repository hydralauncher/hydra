import { forwardRef, useEffect, useState } from "react";

export interface AsyncImageProps
  extends React.DetailedHTMLProps<
    React.ImgHTMLAttributes<HTMLImageElement>,
    HTMLImageElement
  > {
  onSettled?: (url: string) => void;
}

export const AsyncImage = forwardRef<HTMLImageElement, AsyncImageProps>(
  ({ onSettled, ...props }, ref) => {
    const [source, setSource] = useState<string | null>(null);

    useEffect(() => {
      if (props.src && props.src.startsWith("http")) {
        window.electron.getOrCacheImage(props.src).then((url) => {
          setSource(url);

          if (onSettled) onSettled(url);
        });
      }
    }, [props.src, onSettled]);

    return <img ref={ref} {...props} src={source ?? props.src} />;
  }
);

AsyncImage.displayName = "AsyncImage";
