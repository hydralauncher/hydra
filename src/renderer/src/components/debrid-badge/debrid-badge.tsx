import Meteor from "@renderer/assets/meteor.svg?react";
import "./debrid-badge.scss";

export interface DebridBadgeProps {
  collapsed?: boolean;
}

export function DebridBadge({ collapsed }: Readonly<DebridBadgeProps>) {
  return (
    <div className="debrid-badge">
      <Meteor />
      {!collapsed && "Baixe até 2x mais rápido com Nimbus"}
    </div>
  );
}
