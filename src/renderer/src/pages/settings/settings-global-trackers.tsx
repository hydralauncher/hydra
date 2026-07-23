import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@renderer/hooks";
import { useForm } from "react-hook-form";
import { CheckboxField } from "@renderer/components";
import { setUserPreferences } from "@renderer/features";
import { debounce } from "lodash-es";
import "./settings-global-trackers.scss";

interface FormValues {
  manualTrackers: string;
}

const parseManualTrackers = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export function SettingsGlobalTrackers() {
  const { t } = useTranslation("settings");
  const dispatch = useAppDispatch();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { register, setValue, watch } = useForm<FormValues>();

  const [trackerUrl, setTrackerUrl] = useState("");
  const [appendManual, setAppendManual] = useState(false);
  const [appendUrl, setAppendUrl] = useState(false);
  const [isUrlInvalid, setIsUrlInvalid] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  const appendManualRef = useRef(appendManual);
  const appendUrlRef = useRef(appendUrl);
  const initialManualTrackers = useRef<string[]>([]);
  const initialTrackerUrl = useRef("");
  const isMounted = useRef(true);

  useEffect(() => {
    appendManualRef.current = appendManual;
  }, [appendManual]);

  useEffect(() => {
    appendUrlRef.current = appendUrl;
  }, [appendUrl]);

  const manualText = watch("manualTrackers");

  const manualTrackers = useMemo(() => {
    return parseManualTrackers(manualText ?? "");
  }, [manualText]);

  const getCurrentManualTrackers = useCallback(() => {
    return parseManualTrackers(watch("manualTrackers") ?? "");
  }, [watch]);

  const refreshUserPreferences = useCallback(async () => {
    const updatedPreferences = await window.electron.getUserPreferences();
    dispatch(setUserPreferences(updatedPreferences));
  }, [dispatch]);

  const save = useCallback(
    async (
      manual: string[],
      url: string,
      appendManualFlag: boolean,
      appendUrlFlag: boolean,
      fetchUrl: boolean
    ) => {
      const { error } = await window.electron.saveGlobalTrackers(
        manual,
        url || null,
        appendManualFlag,
        appendUrlFlag,
        fetchUrl
      );

      await refreshUserPreferences();

      if (!isMounted.current) return;

      if (!appendUrlFlag || !url) {
        setIsUrlInvalid(false);
      } else if (error) {
        setIsUrlInvalid(true);
      } else {
        setIsUrlInvalid(false);
      }
    },
    [refreshUserPreferences]
  );

  const debouncedSave = useMemo(
    () =>
      debounce((manual: string[], url: string) => {
        void save(
          manual,
          url,
          appendManualRef.current,
          appendUrlRef.current,
          false
        );
      }, 1000),
    [save]
  );

  useEffect(() => {
    if (!userPreferences || isInitialized) return;

    const initialManual = userPreferences.globalTrackers ?? [];
    setValue("manualTrackers", initialManual.join("\n"));
    initialManualTrackers.current = initialManual;

    const initialUrl = userPreferences.globalTrackersUrl ?? "";
    setTrackerUrl(initialUrl);
    initialTrackerUrl.current = initialUrl;

    const am = userPreferences.appendGlobalTrackers ?? false;
    const au = userPreferences.appendGlobalTrackersUrl ?? false;
    setAppendManual(am);
    setAppendUrl(au);
    appendManualRef.current = am;
    appendUrlRef.current = au;
    setIsInitialized(true);
  }, [userPreferences, isInitialized, setValue]);

  useEffect(() => {
    if (!isInitialized) return;

    const manualChanged =
      JSON.stringify(manualTrackers) !==
      JSON.stringify(initialManualTrackers.current);
    const urlChanged = trackerUrl !== initialTrackerUrl.current;

    if (!manualChanged && !urlChanged) return;

    debouncedSave(manualTrackers, trackerUrl);
  }, [manualTrackers, trackerUrl, isInitialized, debouncedSave]);

  useEffect(() => {
    if (!userPreferences || !isInitialized) return;

    initialManualTrackers.current = userPreferences.globalTrackers ?? [];
    initialTrackerUrl.current = userPreferences.globalTrackersUrl ?? "";
  }, [userPreferences, isInitialized]);

  useEffect(() => {
    return () => {
      isMounted.current = false;
      debouncedSave.flush();
    };
  }, [debouncedSave]);

  const handleToggleManual = () => {
    const next = !appendManual;
    setAppendManual(next);
    debouncedSave.cancel();
    void save(getCurrentManualTrackers(), trackerUrl, next, appendUrl, false);
  };

  const handleToggleUrl = () => {
    const next = !appendUrl;
    setAppendUrl(next);
    debouncedSave.cancel();
    void save(getCurrentManualTrackers(), trackerUrl, appendManual, next, next);
  };

  const handleUrlBlur = () => {
    debouncedSave.cancel();
    void save(
      getCurrentManualTrackers(),
      trackerUrl,
      appendManual,
      appendUrl,
      true
    );
  };

  return (
    <form
      className="settings-global-trackers"
      onSubmit={(e) => e.preventDefault()}
    >
      <p className="settings-global-trackers__description">
        {t("global_trackers_description")}
      </p>

      <div className="settings-global-trackers__section">
        <CheckboxField
          label={t("global_trackers_append_manual")}
          checked={appendManual}
          onChange={handleToggleManual}
        />
        <div
          className={`settings-global-trackers__section-content ${
            appendManual
              ? ""
              : "settings-global-trackers__section-content--disabled"
          }`}
        >
          <textarea
            {...register("manualTrackers")}
            className="settings-global-trackers__textarea"
            placeholder={t("global_trackers_manual_placeholder")}
            rows={5}
            disabled={!appendManual}
          />
        </div>
      </div>

      <div className="settings-global-trackers__section">
        <CheckboxField
          label={t("global_trackers_append_url")}
          checked={appendUrl}
          onChange={handleToggleUrl}
        />
        <div
          className={`settings-global-trackers__section-content ${
            appendUrl
              ? ""
              : "settings-global-trackers__section-content--disabled"
          }`}
        >
          <input
            className="settings-global-trackers__url-input"
            type="text"
            value={trackerUrl}
            onChange={(e) => {
              setTrackerUrl(e.target.value);
              setIsUrlInvalid(false);
            }}
            onBlur={handleUrlBlur}
            placeholder={t("global_trackers_url_placeholder")}
            disabled={!appendUrl}
          />
          <span
            className={`settings-global-trackers__url-status ${
              isUrlInvalid
                ? "settings-global-trackers__url-status--invalid"
                : "settings-global-trackers__url-status--hidden"
            }`}
          >
            {isUrlInvalid ? t("global_trackers_fetch_error") : ""}
          </span>
        </div>
      </div>
    </form>
  );
}
