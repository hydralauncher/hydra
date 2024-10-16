import { PersonIcon } from "@primer/octicons-react";

import * as styles from "./avatar.css";

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
    <div className={styles.profileAvatar} style={{ width: size, height: size }}>
      {src ? (
        <img
          className={styles.profileAvatarImage}
          alt={alt}
          src={src}
          {...props}
        />
      ) : (
        <PersonIcon size={size * 0.7} />
      )}
    </div>
  );
}
