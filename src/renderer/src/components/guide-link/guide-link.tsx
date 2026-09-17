import type { ButtonHTMLAttributes, ReactNode } from "react";
import { QuestionIcon } from "@primer/octicons-react";

import "./guide-link.scss";

export interface GuideLinkProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  article: string;
  children: ReactNode;
  iconSize?: number;
}

export function GuideLink({
  article,
  children,
  iconSize = 12,
  className,
  ...buttonProps
}: Readonly<GuideLinkProps>) {
  return (
    <button
      {...buttonProps}
      type="button"
      className={["guide-link", className].filter(Boolean).join(" ")}
      data-open-article={article}
    >
      <span className="guide-link__text">{children}</span>{" "}
      <QuestionIcon size={iconSize} verticalAlign="middle" />
    </button>
  );
}
