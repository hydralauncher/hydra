import { useTranslation } from "react-i18next";

const numberFormatters = new Map<string, Intl.NumberFormat>();

const getNumberFormatter = (language: string) => {
  let formatter = numberFormatters.get(language);
  if (!formatter) {
    formatter = new Intl.NumberFormat(language, { maximumFractionDigits: 0 });
    numberFormatters.set(language, formatter);
  }
  return formatter;
};

export function useFormat() {
  const { i18n } = useTranslation();

  const numberFormatter = getNumberFormatter(i18n.language);

  return { numberFormatter, formatNumber: numberFormatter.format };
}
