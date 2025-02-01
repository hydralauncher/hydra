import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
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

export function DropdownMenu({
  children,
  title,
  items,
  sideOffset = 5,
  side = "bottom",
  loop = true,
  align = "center",
  alignOffset = 0,
}: Readonly<DropdownMenuProps>) {
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <div aria-label={title}>{children}</div>
      </DropdownMenuPrimitive.Trigger>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          sideOffset={sideOffset}
          side={side}
          loop={loop}
          align={align}
          alignOffset={alignOffset}
          className="dropdown-menu__content"
        >
          {title && (
            <DropdownMenuPrimitive.Group className="dropdown-menu__group">
              <div className="dropdown-menu__title-bar">{title}</div>
            </DropdownMenuPrimitive.Group>
          )}

          <DropdownMenuPrimitive.Separator className="dropdown-menu__separator" />

          <DropdownMenuPrimitive.Group className="dropdown-menu__group">
            {items.map(
              (item) =>
                item.show !== false && (
                  <DropdownMenuPrimitive.Item
                    key={item.label}
                    aria-label={item.label}
                    onSelect={item.onClick}
                    className={`dropdown-menu__item ${item.disabled ? "dropdown-menu__item--disabled" : ""}`}
                    disabled={item.disabled}
                  >
                    {item.icon && (
                      <div className="dropdown-menu__item-icon">
                        {item.icon}
                      </div>
                    )}
                    {item.label}
                  </DropdownMenuPrimitive.Item>
                )
            )}
          </DropdownMenuPrimitive.Group>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
