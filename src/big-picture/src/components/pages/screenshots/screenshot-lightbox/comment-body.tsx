import cn from "classnames";

interface ScreenshotCommentBodyProps {
  body: string;
  className?: string;
}

export function ScreenshotCommentBody({
  body,
  className,
}: Readonly<ScreenshotCommentBodyProps>) {
  return <p className={cn("screenshot-comments__body", className)}>{body}</p>;
}
