import React from "react";

import "./badge.scss";

export interface BadgeProps {
  children: React.ReactNode;
}

export function Badge({ children }: BadgeProps) {
  return (
    <div className="badge">
      <span>{children}</span>
    </div>
  );
}
