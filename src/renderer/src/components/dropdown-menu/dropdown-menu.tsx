import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import "./dropdown-menu.scss";

export interface DropdownMenuItem {
  icon?: React.ReactNode;
  label: string;
  disabled?: boolean;
  show?: boolean;
  onClick?: () => void;
}

interface DropdownMenuProps {
  children: React.ReactNode;
  title?: string;
  loop?: boolean;
  items: DropdownMenuItem[];
  sideOffset?: number;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  alignOffset?: number;
}

export default ({
  children,
  title,
  items,
  sideOffset = 5,
  side = "bottom",
  loop = true,
  align = "center",
  alignOffset = 0,
}: DropdownMenuProps) => (
  <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button aria-label={title}>{children}</button>
    </DropdownMenu.Trigger>

    <DropdownMenu.Portal>
      <DropdownMenu.Content
        sideOffset={sideOffset}
        side={side}
        loop={loop}
        align={align}
        alignOffset={alignOffset}
        className="dropdown-menu__content"
      >
        {title && (
          <DropdownMenu.Group className="dropdown-menu__group">
            <div className="dropdown-menu__title-bar">{title}</div>
          </DropdownMenu.Group>
        )}

        <DropdownMenu.Separator className="dropdown-menu__separator" />

        <DropdownMenu.Group className="dropdown-menu__group">
          {items.map(
            (item) =>
              item.show !== false && (
                <DropdownMenu.Item
                  key={item.label}
                  aria-label={item.label}
                  onSelect={item.onClick}
                  className={`dropdown-menu__item ${item.disabled ? "dropdown-menu__item--disabled" : ""}`}
                  disabled={item.disabled}
                >
                  {item.icon && (
                    <div className="dropdown-menu__item-icon">{item.icon}</div>
                  )}
                  {item.label}
                </DropdownMenu.Item>
              )
          )}
        </DropdownMenu.Group>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
);
