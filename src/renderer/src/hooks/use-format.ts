import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export function useFormat() {
  const { i18n } = useTranslation();

  const numberFormatter = useMemo(() => {
    return new Intl.NumberFormat(i18n.language, {
      maximumFractionDigits: 0,
    });
  }, [i18n.language]);

  return { numberFormatter };
}
