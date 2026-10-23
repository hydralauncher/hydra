import { useMemo } from "react";
import cn from "classnames";

import { sanitizeHtml, toRichTextHtml } from "@shared";

import "./rich-text-content.scss";

interface RichTextContentProps {
  html: string;
  className?: string;
}

export function RichTextContent({
  html,
  className,
}: Readonly<RichTextContentProps>) {
  const safeHtml = useMemo(() => sanitizeHtml(toRichTextHtml(html)), [html]);

  return (
    <div
      className={cn("rich-text-content", className)}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}
