import { useEffect, useRef, useState } from "react";
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
  const content = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(true);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (content.current && content.current.scrollHeight !== height) {
      setHeight(isOpen ? content.current.scrollHeight : 0);
    } else if (!isOpen) {
      setHeight(0);
    }
  }, [isOpen, children, height]);

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
        ref={content}
        className="collapsed-menu__content"
        style={{
          maxHeight: `${height}px`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
