import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import cn from "classnames";
import "./context-menu.scss";

export interface ContextMenuItemData {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  submenu?: ContextMenuItemData[];
}

export interface ContextMenuProps {
  items: ContextMenuItemData[];
  visible: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  children?: React.ReactNode;
  className?: string;
}

export function ContextMenu({
  items,
  visible,
  position,
  onClose,
  children,
  className,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const submenuCloseTimeout = useRef<number | null>(null);
  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const [submenuStyles, setSubmenuStyles] = useState<
    Record<string, React.CSSProperties>
  >({});

  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [visible, onClose]);

  useEffect(() => {
    if (!visible || !menuRef.current) return;

    const rect = menuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = position.x;
    let adjustedY = position.y;

    if (position.x + rect.width > viewportWidth) {
      adjustedX = viewportWidth - rect.width - 10;
    }

    if (position.y + rect.height > viewportHeight) {
      adjustedY = viewportHeight - rect.height - 10;
    }

    setAdjustedPosition({ x: adjustedX, y: adjustedY });
  }, [visible, position]);

  useEffect(() => {
    if (!visible) {
      setActiveSubmenu(null);
    }
  }, [visible]);

  const handleItemClick = (item: ContextMenuItemData) => {
    if (item.disabled) return;

    if (item.submenu) {
      setActiveSubmenu(activeSubmenu === item.id ? null : item.id);
      return;
    }

    if (item.onClick) {
      item.onClick();
      onClose();
    }
  };

  const handleSubmenuMouseEnter = (itemId: string) => {
    if (submenuCloseTimeout.current) {
      window.clearTimeout(submenuCloseTimeout.current);
      submenuCloseTimeout.current = null;
    }
    setActiveSubmenu(itemId);
  };

  const handleSubmenuMouseLeave = () => {
    if (submenuCloseTimeout.current) {
      window.clearTimeout(submenuCloseTimeout.current);
    }
    submenuCloseTimeout.current = window.setTimeout(() => {
      setActiveSubmenu(null);
      submenuCloseTimeout.current = null;
    }, 120);
  };

  useEffect(() => {
    if (!activeSubmenu) return;

    const parentEl = itemRefs.current[activeSubmenu];
    if (!parentEl) return;

    const submenuEl = parentEl.querySelector(
      ".context-menu__submenu"
    ) as HTMLElement | null;
    if (!submenuEl) return;

    const parentRect = parentEl.getBoundingClientRect();
    const submenuWidth = submenuEl.offsetWidth;
    const submenuHeight = submenuEl.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const styles: React.CSSProperties = {};

    if (parentRect.right + submenuWidth > viewportWidth - 8) {
      styles.left = "auto";
      styles.right = "calc(100% - 2px)";
    } else {
      styles.left = "calc(100% - 2px)";
      styles.right = undefined;
    }

    const overflowBottom = parentRect.top + submenuHeight - viewportHeight;
    if (overflowBottom > 0) {
      const topAdjust = Math.min(overflowBottom + 8, parentRect.top - 8);
      styles.top = `${-topAdjust}px`;
    } else {
      styles.top = undefined;
    }

    setSubmenuStyles((prev) => ({ ...prev, [activeSubmenu]: styles }));
  }, [activeSubmenu]);

  if (!visible) return null;

  const menuContent = (
    <div
      ref={menuRef}
      className={cn("context-menu", className)}
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
      }}
    >
      <ul className="context-menu__list">
        {items.map((item) => (
          <li
            key={item.id}
            ref={(el) => (itemRefs.current[item.id] = el)}
            className="context-menu__item-container"
            onMouseEnter={() =>
              item.submenu && handleSubmenuMouseEnter(item.id)
            }
            onMouseLeave={() => item.submenu && handleSubmenuMouseLeave()}
          >
            {item.separator && <div className="context-menu__separator" />}
            <button
              type="button"
              className={cn("context-menu__item", {
                "context-menu__item--disabled": item.disabled,
                "context-menu__item--danger": item.danger,
                "context-menu__item--has-submenu": item.submenu,
                "context-menu__item--active": activeSubmenu === item.id,
              })}
              onClick={() => handleItemClick(item)}
              disabled={item.disabled}
            >
              {item.icon && (
                <span className="context-menu__item-icon">{item.icon}</span>
              )}
              <span className="context-menu__item-label">{item.label}</span>
              {item.submenu && (
                <span className="context-menu__item-arrow">▶</span>
              )}
            </button>

            {item.submenu && activeSubmenu === item.id && (
              <div
                className="context-menu__submenu"
                style={submenuStyles[item.id] || undefined}
                onMouseEnter={() => handleSubmenuMouseEnter(item.id)}
                onMouseLeave={() => handleSubmenuMouseLeave()}
              >
                <ul className="context-menu__list">
                  {item.submenu.map((subItem) => (
                    <li
                      key={subItem.id}
                      className="context-menu__item-container"
                    >
                      {subItem.separator && (
                        <div className="context-menu__separator" />
                      )}
                      <button
                        type="button"
                        className={cn("context-menu__item", {
                          "context-menu__item--disabled": subItem.disabled,
                          "context-menu__item--danger": subItem.danger,
                        })}
                        onClick={() => handleItemClick(subItem)}
                        disabled={subItem.disabled}
                      >
                        {subItem.icon && (
                          <span className="context-menu__item-icon">
                            {subItem.icon}
                          </span>
                        )}
                        <span className="context-menu__item-label">
                          {subItem.label}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
      {children && <div className="context-menu__content">{children}</div>}
    </div>
  );

  return createPortal(menuContent, document.body);
}
