import { useRef, useState } from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { TriangleDownIcon } from "@primer/octicons-react";
import cn from "classnames";
import { Button, type ButtonProps } from "@renderer/components";

export interface ScreenshotReviewMenuAction {
  label: string;
  icon?: React.ReactNode;
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
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuWidth, setMenuWidth] = useState<number | null>(null);
  const hasMenu = menuActions.length > 0;

  const handleOpenChange = (open: boolean) => {
    if (open) setMenuWidth(rootRef.current?.offsetWidth || null);
  };

  return (
    <div
      ref={rootRef}
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
        <DropdownMenuPrimitive.Root onOpenChange={handleOpenChange}>
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
              className="screenshot-review-split-button__menu"
              style={menuWidth ? { width: menuWidth } : undefined}
            >
              {menuActions.map((action) => (
                <DropdownMenuPrimitive.Item
                  key={action.label}
                  className={cn(
                    "button",
                    `button--${theme}`,
                    "screenshot-review-split-button__menu-item"
                  )}
                  onSelect={action.onSelect}
                >
                  {action.icon}
                  {action.label}
                </DropdownMenuPrimitive.Item>
              ))}
            </DropdownMenuPrimitive.Content>
          </DropdownMenuPrimitive.Portal>
        </DropdownMenuPrimitive.Root>
      )}
    </div>
  );
}
