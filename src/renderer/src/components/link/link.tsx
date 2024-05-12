import { Link as ReactRouterDomLink, LinkProps } from "react-router-dom";
import cn from "classnames";
import * as styles from "./link.css";

export function Link({ children, to, className, ...props }: LinkProps) {
  const openExternal = (event: React.MouseEvent) => {
    event.preventDefault();
    window.electron.openExternal(to as string);
  };

  if (typeof to === "string" && to.startsWith("http")) {
    return (
      <a
        href={to}
        className={cn(styles.link, className)}
        onClick={openExternal}
        {...props}
      >
        {children}
      </a>
    );
  }

  return (
    <ReactRouterDomLink
      className={cn(styles.link, className)}
      to={to}
      {...props}
    >
      {children}
    </ReactRouterDomLink>
  );
}
