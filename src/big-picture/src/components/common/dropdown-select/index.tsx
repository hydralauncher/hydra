import "./styles.scss";

import { flip, offset, shift, size } from "@floating-ui/dom";
import { CaretDownIcon, CheckCircle } from "@phosphor-icons/react";
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
import { MODAL_OWNED_OVERLAY_ATTRIBUTE } from "../modal";
import { NavigationLayer } from "../navigation-layer";
import { VerticalFocusGroup } from "../vertical-focus-group";

const DROPDOWN_MENU_OFFSET = 8;
const DROPDOWN_MIN_WIDTH = 220;
const DROPDOWN_VIEWPORT_MARGIN = 16;
const DROPDOWN_MAX_HEIGHT = 360;

export interface DropdownSelectOption<TValue extends string = string> {
  value: TValue;
  label: ReactNode;
  icon?: ReactNode;
  description?: ReactNode;
}

export interface DropdownSelectProps<TValue extends string = string> {
  label?: string;
  hideLabel?: boolean;
  leadingIcon?: ReactNode;
  disabled?: boolean;
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

function hasRichOptionContent<TValue extends string = string>(
  option: DropdownSelectOption<TValue> | undefined
) {
  return Boolean(option?.icon || option?.description);
}

function renderOptionContent<TValue extends string = string>(
  option: DropdownSelectOption<TValue> | undefined,
  fallbackLabel: ReactNode,
  {
    fallbackIcon,
  }: {
    fallbackIcon?: ReactNode;
  } = {}
) {
  if (!option) {
    return <span className="dropdown-select__value">{fallbackLabel}</span>;
  }

  const icon = option.icon ?? fallbackIcon;
  const isRich = hasRichOptionContent(option);

  if (!isRich) {
    return (
      <>
        {icon ? (
          <span className="dropdown-select__lead" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span className="dropdown-select__value">{option.label}</span>
      </>
    );
  }

  return (
    <>
      {icon ? (
        <span className="dropdown-select__option-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="dropdown-select__option-content">
        <span className="dropdown-select__option-label">{option.label}</span>
        {option.description ? (
          <span className="dropdown-select__option-description">
            {option.description}
          </span>
        ) : null}
      </span>
    </>
  );
}

export function DropdownSelect<TValue extends string = string>({
  label,
  hideLabel = false,
  leadingIcon,
  disabled = false,
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
  const selectedOptionIsRich = hasRichOptionContent(selectedOption);

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
    globalThis.window?.requestAnimationFrame(() => {
      setFocus(resolvedBaseId);
    });
  }, [resolvedBaseId, setFocus]);

  const closeMenu = useCallback(
    (restoreFocus = false) => {
      setIsOpen(false);

      if (restoreFocus) {
        restoreTriggerFocus();
      }
    },
    [restoreTriggerFocus]
  );

  useEffect(() => {
    if (!disabled) return;

    setIsOpen(false);
  }, [disabled]);

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
        apply({ rects, elements, availableWidth, availableHeight }) {
          const maxHeight =
            Number.isFinite(availableHeight) && availableHeight > 0
              ? Math.min(DROPDOWN_MAX_HEIGHT, availableHeight)
              : DROPDOWN_MAX_HEIGHT;
          const referenceWidth = rects.reference.width;
          const constrainedWidth =
            typeof availableWidth === "number" && availableWidth > 0
              ? Math.min(referenceWidth, availableWidth)
              : referenceWidth;
          const resolvedWidth = Math.max(
            constrainedWidth,
            Math.min(DROPDOWN_MIN_WIDTH, availableWidth || DROPDOWN_MIN_WIDTH)
          );

          Object.assign(elements.floating.style, {
            width: `${resolvedWidth}px`,
            minWidth: `${resolvedWidth}px`,
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

  const handleTriggerClick = useCallback(() => {
    if (disabled) return;

    if (!isOpen) {
      setFocus(resolvedBaseId);
    }

    setIsOpen((currentOpen) => !currentOpen);
  }, [disabled, isOpen, resolvedBaseId, setFocus]);

  useNavigationScreenActions(
    isOpen && !disabled
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
        {disabled ? (
          <button
            type="button"
            className={`dropdown-select__trigger${
              selectedOptionIsRich ? " dropdown-select__trigger--rich" : ""
            }`}
            aria-label={resolvedAriaLabel}
            aria-disabled="true"
            aria-haspopup="listbox"
            aria-expanded="false"
            data-disabled="true"
            disabled
          >
            <span className="dropdown-select__trigger-main">
              {renderOptionContent(selectedOption, resolvedLabel, {
                fallbackIcon: leadingIcon,
              })}
            </span>
            <CaretDownIcon
              size={18}
              className="dropdown-select__chevron"
              aria-hidden="true"
            />
          </button>
        ) : (
          <FocusItem
            id={resolvedBaseId}
            asChild
            navigationOverrides={focusNavigationOverrides}
          >
            <button
              type="button"
              className={`dropdown-select__trigger${
                selectedOptionIsRich ? " dropdown-select__trigger--rich" : ""
              }`}
              aria-label={resolvedAriaLabel}
              aria-haspopup="listbox"
              aria-expanded={isOpen}
              data-open={isOpen || undefined}
              onClick={handleTriggerClick}
            >
              <span className="dropdown-select__trigger-main">
                {renderOptionContent(selectedOption, resolvedLabel, {
                  fallbackIcon: leadingIcon,
                })}
              </span>
              <CaretDownIcon
                size={18}
                className="dropdown-select__chevron"
                aria-hidden="true"
              />
            </button>
          </FocusItem>
        )}
      </div>

      {isOpen && !disabled && portalTarget
        ? createPortal(
            <FocusRegionContext.Provider value={null}>
              <NavigationLayer
                rootRegionId={resolvedMenuRegionId}
                initialFocusId={initialFocusId}
              >
                <div
                  ref={floatingRef}
                  className="dropdown-select__popover-wrapper"
                  {...{ [MODAL_OWNED_OVERLAY_ATTRIBUTE]: "" }}
                >
                  <VerticalFocusGroup
                    regionId={resolvedMenuRegionId}
                    className="dropdown-select__menu"
                    style={{ gap: 0 }}
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
                            className={`dropdown-select__option${
                              hasRichOptionContent(option)
                                ? " dropdown-select__option--rich"
                                : ""
                            }`}
                            data-selected={isSelected || undefined}
                            onClick={() => handleOptionSelect(option.value)}
                          >
                            {renderOptionContent(option, option.label)}

                            {isSelected ? (
                              <CheckCircle
                                size={16}
                                weight="fill"
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
