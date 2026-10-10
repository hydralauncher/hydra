import cn from "classnames";

import "./cloud-ring.scss";

export interface CloudRingProps {
  /** Corner radius of the ring; the framed avatar uses 2px less. */
  radius?: number;
  className?: string;
  children: React.ReactNode;
}

/**
 * Animated Hydra Cloud frame for avatars, matching the mobile app's
 * `CloudRing`.
 */
export function CloudRing({
  radius = 7,
  className,
  children,
}: Readonly<CloudRingProps>) {
  return (
    <div
      className={cn("cloud-ring", className)}
      style={{ "--cloud-ring-radius": `${radius}px` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
