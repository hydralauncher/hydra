import "./language-section.scss";

import { CaretRightIcon, GlobeHemisphereWestIcon } from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";

import { Button } from "../../components";
import { useNavigation, useUserPreferences } from "../../hooks";
import { LanguagePickerModal } from "./language-picker-modal";
import { resolveCurrentLanguageOption } from "./language-options";
import { SettingsSection } from "./settings-section";

interface LanguageSectionProps {
  className?: string;
}

const GITHUB_REPOSITORY_URL = "https://github.com/hydralauncher/hydra";
const LANGUAGE_SECTION_BUTTON_ID = "language-section-button";

export function LanguageSection({
  className,
}: Readonly<LanguageSectionProps>) {
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
            onClick={() => setIsLanguagePickerOpen(true)}
            icon={<CaretRightIcon size={18} aria-hidden="true" />}
            iconPosition="right"
          >
            <span className="language-section__button-content">
              {currentLanguage.flag ? (
                <span className="language-section__flag" aria-hidden="true">
                  {currentLanguage.flag}
                </span>
              ) : (
                <GlobeHemisphereWestIcon size={18} aria-hidden="true" />
              )}

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
