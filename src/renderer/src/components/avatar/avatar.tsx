import { PersonIcon } from "@primer/octicons-react";

import "./avatar.scss";

export interface AvatarProps
  extends Omit<
    React.DetailedHTMLProps<
      React.ImgHTMLAttributes<HTMLImageElement>,
      HTMLImageElement
    >,
    "src"
  > {
  size: number;
  src?: string | null;
}

export function Avatar({ size, alt, src, ...props }: AvatarProps) {
  return (
    <div className="profile-avatar" style={{ width: size, height: size }}>
      {src ? (
        <img
          className="profile-avatar__image"
          alt={alt}
          src={src}
          width={size}
          height={size}
          {...props}
        />
      ) : (
        <PersonIcon size={size * 0.7} />
      )}
    </div>
  );
}
