import "./styles.scss";

import type { AnchorHTMLAttributes } from "react";

export interface SourceAnchorProps
  extends AnchorHTMLAttributes<HTMLAnchorElement> {
  title: string;
  href?: string;
}

export function SourceAnchor({
  title,
  href,
  ...props
}: Readonly<SourceAnchorProps>) {
  return (
    <>
      {href ? (
        <a href={href} {...props}>
          <div className="source-anchor source-anchor--link">
            <p className="source-anchor__title">{title}</p>
          </div>
        </a>
      ) : (
        <div className="source-anchor">
          <p className="source-anchor__title">{title}</p>
        </div>
      )}
    </>
  );
}
