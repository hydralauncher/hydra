import "./language-section.scss";

import { CaretRightIcon } from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";

import { Button } from "../../components";
import { useNavigation, useUserPreferences } from "../../hooks";
import { LanguagePickerModal } from "./language-picker-modal";
import { LanguageFlag } from "./language-flag";
import { resolveCurrentLanguageOption } from "./language-options";
import {
  BEHAVIOR_SECTION_REGION_ID,
  LANGUAGE_SECTION_BUTTON_ID,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";

interface LanguageSectionProps {
  className?: string;
}

const GITHUB_REPOSITORY_URL = "https://github.com/hydralauncher/hydra";

export function LanguageSection({ className }: Readonly<LanguageSectionProps>) {
  const userPreferences = useUserPreferences();
  const { setFocus } = useNavigation();
  const [isLanguagePickerOpen, setIsLanguagePickerOpen] = useState(false);

  const currentLanguage = useMemo(() => {
    return resolveCurrentLanguageOption(userPreferences?.language);
  }, [userPreferences?.language]);

  const handleOpenRepository = useCallback(
    async (event: React.MouseEvent<HTMLAnchorElement>) => {
      const electron = globalThis.window.electron as {
        openExternal?: (src: string) => Promise<void>;
      };

      if (typeof electron.openExternal !== "function") {
        return;
      }

      event.preventDefault();
      await electron.openExternal(GITHUB_REPOSITORY_URL);
    },
    []
  );

  const handleCloseLanguagePicker = useCallback(() => {
    setIsLanguagePickerOpen(false);

    globalThis.window.requestAnimationFrame(() => {
      setFocus(LANGUAGE_SECTION_BUTTON_ID);
    });
  }, [setFocus]);

  return (
    <>
      <SettingsSection
        title="Language"
        description={
          <>
            Don&apos;t see your language on the list?{" "}
            <a
              className="language-section__link"
              href={GITHUB_REPOSITORY_URL}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                void handleOpenRepository(event);
              }}
            >
              Contribute!
            </a>
          </>
        }
        className={className}
      >
        <div className="language-section__controls">
          <Button
            variant="secondary"
            size="small"
            className="language-section__button"
            focusId={LANGUAGE_SECTION_BUTTON_ID}
            focusNavigationOverrides={{
              down: {
                type: "region",
                regionId: BEHAVIOR_SECTION_REGION_ID,
                entryDirection: "down",
                preferRememberedFocus: false,
              },
            }}
            onClick={() => setIsLanguagePickerOpen(true)}
            icon={<CaretRightIcon size={18} aria-hidden="true" />}
            iconPosition="right"
          >
            <span className="language-section__button-content">
              <LanguageFlag
                countryCode={currentLanguage.flagCountryCode}
                className="language-section__flag"
              />

              <span className="language-section__label">
                {currentLanguage.nativeName}
              </span>
            </span>
          </Button>
        </div>
      </SettingsSection>

      <LanguagePickerModal
        visible={isLanguagePickerOpen}
        onClose={handleCloseLanguagePicker}
      />
    </>
  );
}
