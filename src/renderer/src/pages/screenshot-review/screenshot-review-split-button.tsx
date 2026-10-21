import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { TriangleDownIcon } from "@primer/octicons-react";
import cn from "classnames";
import { Button, type ButtonProps } from "@renderer/components";

import "@renderer/components/dropdown-menu/dropdown-menu.scss";

export interface ScreenshotReviewMenuAction {
  label: string;
  onSelect: () => void;
}

interface ScreenshotReviewSplitButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  menuLabel: string;
  menuActions: ScreenshotReviewMenuAction[];
  theme?: ButtonProps["theme"];
  disabled?: boolean;
  className?: string;
}

export function ScreenshotReviewSplitButton({
  children,
  onClick,
  menuLabel,
  menuActions,
  theme = "primary",
  disabled = false,
  className,
}: Readonly<ScreenshotReviewSplitButtonProps>) {
  const hasMenu = menuActions.length > 0;

  return (
    <div
      className={cn(
        "screenshot-review-split-button",
        { "screenshot-review-split-button--with-menu": hasMenu },
        className
      )}
    >
      <Button
        className="screenshot-review-split-button__main"
        theme={theme}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </Button>

      {hasMenu && (
        <DropdownMenuPrimitive.Root>
          <DropdownMenuPrimitive.Trigger asChild disabled={disabled}>
            <Button
              className="screenshot-review-split-button__toggle"
              theme={theme}
              disabled={disabled}
              aria-label={menuLabel}
            >
              <TriangleDownIcon size={16} />
            </Button>
          </DropdownMenuPrimitive.Trigger>

          <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.Content
              side="top"
              align="end"
              sideOffset={6}
              collisionPadding={12}
              className="dropdown-menu__content screenshot-review-split-button__menu"
            >
              <DropdownMenuPrimitive.Group className="dropdown-menu__group">
                {menuActions.map((action) => (
                  <DropdownMenuPrimitive.Item
                    key={action.label}
                    className="dropdown-menu__item"
                    onSelect={action.onSelect}
                  >
                    {action.label}
                  </DropdownMenuPrimitive.Item>
                ))}
              </DropdownMenuPrimitive.Group>
            </DropdownMenuPrimitive.Content>
          </DropdownMenuPrimitive.Portal>
        </DropdownMenuPrimitive.Root>
      )}
    </div>
  );
}
