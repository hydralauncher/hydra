import React from "react";
import * as styles from "./badge.css";

export interface BadgeProps {
  children: React.ReactNode;
}

export function Badge({ children }: BadgeProps) {
  return (
    <div className={styles.badge}>
      <span>{children}</span>
    </div>
  );
}
