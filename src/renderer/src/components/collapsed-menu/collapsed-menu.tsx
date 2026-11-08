import { useState } from "react";
import { ChevronDownIcon } from "@primer/octicons-react";
import "./collapsed-menu.scss";

export interface CollapsedMenuProps {
  title: string;
  children: React.ReactNode;
}

export function CollapsedMenu({
  title,
  children,
}: Readonly<CollapsedMenuProps>) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="collapsed-menu">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="collapsed-menu__button"
      >
        <ChevronDownIcon
          className={`collapsed-menu__chevron ${
            isOpen ? "collapsed-menu__chevron--open" : ""
          }`}
        />
        <span>{title}</span>
      </button>

      <div
        className={`collapsed-menu__content${isOpen ? "" : " collapsed-menu__content--closed"}`}
        aria-hidden={!isOpen}
      >
        <div className="collapsed-menu__body">{children}</div>
      </div>
    </div>
  );
}
