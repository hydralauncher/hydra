import "./language-picker-modal.scss";

import { CheckCircleIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  FocusItem,
  GridFocusGroup,
  Input,
  Modal,
  VerticalFocusGroup,
} from "../../components";
import { getItemFocusTarget } from "../../helpers";
import { useNavigation, useUserPreferences } from "../../hooks";
import {
  getLanguageOptions,
  resolveCurrentLanguageOption,
} from "./language-options";
import { LanguageFlag } from "./language-flag";
import {
  buildLanguagePickerGridNavigation,
  findLanguagePickerReplacementFocusId,
} from "./use-language-picker-grid-navigation";

interface LanguagePickerModalProps {
  visible: boolean;
  onClose: () => void;
}

const LANGUAGE_PICKER_SEARCH_INPUT_ID = "language-picker-search-input";
const LANGUAGE_PICKER_GRID_REGION_ID = "language-picker-grid-region";
const LANGUAGE_PICKER_GRID_COLUMN_COUNT = 3;

function getLanguageCardFocusId(localeKey: string) {
  return `language-picker-item-${localeKey.toLowerCase()}`;
}

function normalizeSearchValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

export function LanguagePickerModal({
  visible,
  onClose,
}: Readonly<LanguagePickerModalProps>) {
  const userPreferences = useUserPreferences();
  const { currentFocusId, setFocus } = useNavigation();
  const [searchTerm, setSearchTerm] = useState("");
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const previousCoordinatesByItemIdRef = useRef<
    Record<string, { rowIndex: number; columnIndex: number }>
  >({});
  const getGridScrollAnchor = useCallback(() => gridScrollRef.current, []);

  const currentLanguage = useMemo(() => {
    return resolveCurrentLanguageOption(userPreferences?.language);
  }, [userPreferences?.language]);

  const languageOptions = useMemo(() => {
    return getLanguageOptions().map((languageOption) => ({
      ...languageOption,
      isSelected: languageOption.localeKey === currentLanguage.localeKey,
    }));
  }, [currentLanguage.localeKey]);

  const filteredLanguageOptions = useMemo(() => {
    const normalizedSearchTerm = normalizeSearchValue(searchTerm.trim());

    if (!normalizedSearchTerm) {
      return languageOptions;
    }

    return languageOptions.filter((languageOption) => {
      const searchableValues = [
        languageOption.nativeName,
        languageOption.englishName,
      ];

      return searchableValues.some((searchableValue) =>
        normalizeSearchValue(searchableValue).includes(normalizedSearchTerm)
      );
    });
  }, [languageOptions, searchTerm]);

  const filteredLanguageItems = useMemo(() => {
    return filteredLanguageOptions.map((languageOption) => ({
      ...languageOption,
      focusId: getLanguageCardFocusId(languageOption.localeKey),
    }));
  }, [filteredLanguageOptions]);
  const firstVisibleLanguageFocusId = filteredLanguageItems[0]?.focusId ?? null;
  const filteredLanguageFocusIds = useMemo(() => {
    return filteredLanguageItems.map((languageItem) => languageItem.focusId);
  }, [filteredLanguageItems]);
  const { overridesByItemId, coordinatesByItemId } = useMemo(() => {
    return buildLanguagePickerGridNavigation({
      itemIds: filteredLanguageFocusIds,
      searchInputId: LANGUAGE_PICKER_SEARCH_INPUT_ID,
      columnCount: LANGUAGE_PICKER_GRID_COLUMN_COUNT,
    });
  }, [filteredLanguageFocusIds]);

  useEffect(() => {
    if (visible) return;

    setSearchTerm("");
  }, [visible]);

  useEffect(() => {
    if (!visible) return;

    const frameId = globalThis.window.requestAnimationFrame(() => {
      setFocus(LANGUAGE_PICKER_SEARCH_INPUT_ID);
    });

    return () => {
      globalThis.window.cancelAnimationFrame(frameId);
    };
  }, [setFocus, visible]);

  useEffect(() => {
    if (!visible) return;

    let frameId: number | null = null;
    const visibleFocusIds = new Set(filteredLanguageFocusIds);

    const isLanguageCardFocused =
      currentFocusId?.startsWith("language-picker-item-") ?? false;

    if (filteredLanguageFocusIds.length === 0) {
      if (currentFocusId !== LANGUAGE_PICKER_SEARCH_INPUT_ID) {
        frameId = globalThis.window.requestAnimationFrame(() => {
          setFocus(LANGUAGE_PICKER_SEARCH_INPUT_ID);
        });
      }
    } else if (
      isLanguageCardFocused &&
      currentFocusId &&
      !visibleFocusIds.has(currentFocusId)
    ) {
      const replacementFocusId = findLanguagePickerReplacementFocusId({
        itemIds: filteredLanguageFocusIds,
        coordinatesByItemId,
        previousCoordinates:
          previousCoordinatesByItemIdRef.current[currentFocusId],
      });

      frameId = globalThis.window.requestAnimationFrame(() => {
        if (replacementFocusId) {
          setFocus(replacementFocusId);
        }
      });
    }

    return () => {
      if (frameId !== null) {
        globalThis.window.cancelAnimationFrame(frameId);
      }
    };
  }, [
    coordinatesByItemId,
    currentFocusId,
    filteredLanguageFocusIds,
    setFocus,
    visible,
  ]);

  useEffect(() => {
    previousCoordinatesByItemIdRef.current = coordinatesByItemId;
  }, [coordinatesByItemId]);

  const handleSelectLanguage = useCallback(
    async (localeKey: string) => {
      await globalThis.window.electron.updateUserPreferences({
        language: localeKey,
      });
      onClose();
    },
    [onClose]
  );

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title="Language Selector"
      description="Choose your preferred system language."
      className="language-picker-modal"
    >
      <VerticalFocusGroup className="language-picker-modal__content">
        <Input
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search language"
          iconLeft={<MagnifyingGlassIcon size={20} />}
          className="language-picker-modal__search"
          focusId={LANGUAGE_PICKER_SEARCH_INPUT_ID}
          focusNavigationOverrides={{
            down: firstVisibleLanguageFocusId
              ? getItemFocusTarget(firstVisibleLanguageFocusId)
              : { type: "block" },
            up: { type: "block" },
          }}
        />

        <div ref={gridScrollRef} className="language-picker-modal__grid-scroll">
          {filteredLanguageOptions.length > 0 ? (
            <GridFocusGroup
              className="language-picker-modal__grid"
              regionId={LANGUAGE_PICKER_GRID_REGION_ID}
              getScrollAnchor={getGridScrollAnchor}
            >
              {filteredLanguageItems.map((languageItem) => {
                return (
                  <FocusItem
                    key={languageItem.localeKey}
                    id={languageItem.focusId}
                    asChild
                    navigationOverrides={
                      overridesByItemId[languageItem.focusId] ?? {
                        up: getItemFocusTarget(LANGUAGE_PICKER_SEARCH_INPUT_ID),
                        down: { type: "block" },
                        left: { type: "block" },
                        right: { type: "block" },
                      }
                    }
                  >
                    <button
                      className={`language-picker-modal__card${
                        languageItem.isSelected
                          ? " language-picker-modal__card--selected"
                          : ""
                      }`}
                      onClick={() => {
                        void handleSelectLanguage(languageItem.localeKey);
                      }}
                    >
                      <div className="language-picker-modal__card-main">
                        <LanguageFlag
                          countryCode={languageItem.flagCountryCode}
                          className="language-picker-modal__flag"
                        />

                        <span className="language-picker-modal__card-label">
                          {languageItem.nativeName}
                        </span>
                      </div>

                      {languageItem.isSelected ? (
                        <span
                          className="language-picker-modal__selected-indicator"
                          aria-hidden="true"
                        >
                          <CheckCircleIcon size={18} weight="fill" />
                        </span>
                      ) : null}
                    </button>
                  </FocusItem>
                );
              })}
            </GridFocusGroup>
          ) : (
            <p className="language-picker-modal__empty">No languages found.</p>
          )}
        </div>
      </VerticalFocusGroup>
    </Modal>
  );
}
