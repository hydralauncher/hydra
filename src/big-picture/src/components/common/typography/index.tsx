import "./styles.scss";

import cn from "classnames";
import { forwardRef, type HTMLAttributes } from "react";

export interface TypographyProps extends HTMLAttributes<
  HTMLHeadingElement | HTMLParagraphElement | HTMLLabelElement
> {
  variant?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "body" | "label";
}

export const Typography = forwardRef<
  HTMLHeadingElement | HTMLParagraphElement | HTMLLabelElement,
  TypographyProps
>(({ children, variant = "body", ...props }, ref) => {
  const { className, ...rest } = props;

  switch (variant) {
    case "h1":
      return (
        <h1
          {...rest}
          ref={ref as React.Ref<HTMLHeadingElement>}
          className={cn("typography typography--h1", className)}
        >
          {children}
        </h1>
      );
    case "h2":
      return (
        <h2
          {...rest}
          ref={ref as React.Ref<HTMLHeadingElement>}
          className={cn("typography typography--h2", className)}
        >
          {children}
        </h2>
      );
    case "h3":
      return (
        <h3
          {...rest}
          ref={ref as React.Ref<HTMLHeadingElement>}
          className={cn("typography typography--h3", className)}
        >
          {children}
        </h3>
      );
    case "h4":
      return (
        <h4
          {...rest}
          ref={ref as React.Ref<HTMLHeadingElement>}
          className={cn("typography typography--h4", className)}
        >
          {children}
        </h4>
      );
    case "h5":
      return (
        <h5
          {...rest}
          ref={ref as React.Ref<HTMLHeadingElement>}
          className={cn("typography typography--h5", className)}
        >
          {children}
        </h5>
      );
    case "h6":
      return (
        <h6
          {...rest}
          ref={ref as React.Ref<HTMLHeadingElement>}
          className={cn("typography typography--h6", className)}
        >
          {children}
        </h6>
      );
    case "label":
      return (
        <label
          {...rest}
          ref={ref as React.Ref<HTMLLabelElement>}
          className={cn("typography typography--label", className)}
        >
          {children}
        </label>
      );
    default:
      return (
        <p
          {...rest}
          ref={ref as React.Ref<HTMLParagraphElement>}
          className={cn("typography typography--body", className)}
        >
          {children}
        </p>
      );
  }
});

Typography.displayName = "Typography";
