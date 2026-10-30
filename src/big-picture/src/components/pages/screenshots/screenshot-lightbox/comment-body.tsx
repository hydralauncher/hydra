import cn from "classnames";
import { useMemo } from "react";
import { sanitizeCommentHtml, toRichTextHtml } from "@shared";

interface ScreenshotCommentBodyProps {
  bodyHtml: string;
  className?: string;
}

export function ScreenshotCommentBody({
  bodyHtml,
  className,
}: Readonly<ScreenshotCommentBodyProps>) {
  const safeHtml = useMemo(
    () => sanitizeCommentHtml(toRichTextHtml(bodyHtml)),
    [bodyHtml]
  );

  return (
    <div
      className={cn("screenshot-comments__body", className)}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}
