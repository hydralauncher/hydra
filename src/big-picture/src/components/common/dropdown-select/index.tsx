import "./styles.scss";

import { flip, offset, shift, size } from "@floating-ui/dom";
import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  useFloatingPanelPosition,
  useNavigation,
  useNavigationScreenActions,
} from "../../../hooks";
import type { FocusOverrides } from "../../../services";
import { FocusRegionContext } from "../../context";
import { FocusItem } from "../focus-item";
import { NavigationLayer } from "../navigation-layer";
import { VerticalFocusGroup } from "../vertical-focus-group";

const DROPDOWN_MENU_OFFSET = 8;
const DROPDOWN_MIN_WIDTH = 220;
const DROPDOWN_VIEWPORT_MARGIN = 16;
const DROPDOWN_MAX_HEIGHT = 360;

export interface DropdownSelectOption<TValue extends string = string> {
  value: TValue;
  label: ReactNode;
}

export interface DropdownSelectProps<TValue extends string = string> {
  label?: string;
  hideLabel?: boolean;
  leadingIcon?: ReactNode;
  value: TValue;
  options: Array<DropdownSelectOption<TValue>>;
  onValueChange: (value: TValue) => void;
  focusId?: string;
  focusNavigationOverrides?: FocusOverrides;
  className?: string;
  menuRegionId?: string;
  ariaLabel?: string;
}

function getOptionKeySuffix(value: string) {
  return value.replaceAll(/[^a-z0-9_-]/gi, "-").toLowerCase();
}

export function DropdownSelect<TValue extends string = string>({
  label,
  hideLabel = false,
  leadingIcon,
  value,
  options,
  onValueChange,
  focusId,
  focusNavigationOverrides,
  className = "",
  menuRegionId,
  ariaLabel,
}: Readonly<DropdownSelectProps<TValue>>) {
  const generatedId = useId();
  const { setFocus } = useNavigation();
  const referenceRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const resolvedBaseId =
    focusId ?? `dropdown-select-${generatedId.replaceAll(":", "")}`;
  const resolvedMenuRegionId = menuRegionId ?? `${resolvedBaseId}-menu`;
  const selectedOption = options.find((option) => option.value === value);
  const resolvedLabel = selectedOption?.label ?? value;
  const resolvedAriaLabel = ariaLabel ?? label;

  const optionIds = useMemo(() => {
    return new Map(
      options.map((option) => [
        option.value,
        `${resolvedBaseId}-option-${getOptionKeySuffix(option.value)}`,
      ])
    );
  }, [options, resolvedBaseId]);

  const initialFocusId =
    optionIds.get(value) ?? optionIds.get(options[0]?.value ?? "");

  const restoreTriggerFocus = useCallback(() => {
    if (!focusId) return;

    globalThis.window?.requestAnimationFrame(() => {
      setFocus(focusId);
    });
  }, [focusId, setFocus]);

  const closeMenu = useCallback(
    (restoreFocus = false) => {
      setIsOpen(false);

      if (restoreFocus) {
        restoreTriggerFocus();
      }
    },
    [restoreTriggerFocus]
  );

  const handleOptionSelect = useCallback(
    (nextValue: TValue) => {
      onValueChange(nextValue);
      closeMenu(true);
    },
    [closeMenu, onValueChange]
  );

  const floatingMiddleware = useMemo(
    () => [
      offset(DROPDOWN_MENU_OFFSET),
      flip({ fallbackPlacements: ["top"] }),
      shift({ padding: DROPDOWN_VIEWPORT_MARGIN }),
      size({
        apply({ elements, availableWidth, availableHeight }) {
          const maxHeight =
            Number.isFinite(availableHeight) && availableHeight > 0
              ? Math.min(DROPDOWN_MAX_HEIGHT, availableHeight)
              : DROPDOWN_MAX_HEIGHT;

          Object.assign(elements.floating.style, {
            width: "max-content",
            minWidth: `${DROPDOWN_MIN_WIDTH}px`,
            maxWidth:
              typeof availableWidth === "number" && availableWidth > 0
                ? `${availableWidth}px`
                : "",
            maxHeight: `${maxHeight}px`,
          });
        },
      }),
    ],
    []
  );
  const { floatingRef } = useFloatingPanelPosition<HTMLDivElement>({
    isOpen,
    reference: referenceRef.current,
    placement: "bottom",
    middleware: floatingMiddleware,
  });

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;

      if (
        !target ||
        referenceRef.current?.contains(target) ||
        floatingRef.current?.contains(target)
      ) {
        return;
      }

      closeMenu(false);
    };

    globalThis.document.addEventListener("mousedown", handlePointerDown);

    return () => {
      globalThis.document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [closeMenu, floatingRef, isOpen]);

  useNavigationScreenActions(
    isOpen
      ? {
          press: {
            b: () => closeMenu(true),
            select: () => closeMenu(true),
          },
        }
      : {}
  );

  /** Must mount inside `#big-picture`: PostCSS scopes all BP component CSS to `#big-picture ...`. */
  const portalTarget =
    globalThis.document === undefined
      ? null
      : (globalThis.document.getElementById("big-picture") ??
        globalThis.document.getElementById("root") ??
        globalThis.document.body);

  const rootClassName = [
    "dropdown-select",
    hideLabel ? "dropdown-select--compact" : "",
    className,
  ]
    .filter((part) => part.length > 0)
    .join(" ");

  const showExternalLabel = !hideLabel && Boolean(label);

  return (
    <div className={rootClassName}>
      {showExternalLabel ? (
        <span className="dropdown-select__label">{label}</span>
      ) : null}

      <div ref={referenceRef} className="dropdown-select__trigger-anchor">
        <FocusItem
          id={focusId}
          asChild
          navigationOverrides={focusNavigationOverrides}
        >
          <button
            type="button"
            className="dropdown-select__trigger"
            aria-label={resolvedAriaLabel}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            data-open={isOpen || undefined}
            onClick={() => setIsOpen((currentOpen) => !currentOpen)}
          >
            <span className="dropdown-select__trigger-main">
              {leadingIcon ? (
                <span className="dropdown-select__lead" aria-hidden="true">
                  {leadingIcon}
                </span>
              ) : null}
              <span className="dropdown-select__value">{resolvedLabel}</span>
            </span>
            <CaretDownIcon
              size={18}
              className="dropdown-select__chevron"
              aria-hidden="true"
            />
          </button>
        </FocusItem>
      </div>

      {isOpen && portalTarget
        ? createPortal(
            <FocusRegionContext.Provider value={null}>
              <NavigationLayer
                rootRegionId={resolvedMenuRegionId}
                initialFocusId={initialFocusId}
              >
                <div
                  ref={floatingRef}
                  className="dropdown-select__popover-wrapper"
                >
                  <VerticalFocusGroup
                    regionId={resolvedMenuRegionId}
                    className="dropdown-select__menu"
                    style={{
                      gap: "calc(var(--spacing-unit) * 1)",
                    }}
                    role="listbox"
                    aria-label={resolvedAriaLabel}
                  >
                    {options.map((option) => {
                      const isSelected = option.value === value;
                      const optionId = optionIds.get(option.value);

                      return (
                        <FocusItem
                          key={option.value}
                          id={optionId}
                          asChild
                          navigationOverrides={{
                            left: { type: "block" },
                            right: { type: "block" },
                          }}
                        >
                          <button
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            className="dropdown-select__option"
                            data-selected={isSelected || undefined}
                            onClick={() => handleOptionSelect(option.value)}
                          >
                            <span className="dropdown-select__option-label">
                              {option.label}
                            </span>

                            {isSelected ? (
                              <CheckIcon
                                size={18}
                                className="dropdown-select__option-check"
                                aria-hidden="true"
                              />
                            ) : null}
                          </button>
                        </FocusItem>
                      );
                    })}
                  </VerticalFocusGroup>
                </div>
              </NavigationLayer>
            </FocusRegionContext.Provider>,
            portalTarget
          )
        : null}
    </div>
  );
}
