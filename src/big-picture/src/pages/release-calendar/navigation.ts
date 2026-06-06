export const RELEASE_CALENDAR_PAGE_REGION_ID = "release-calendar-page";
export const RELEASE_CALENDAR_MONTH_TABS_REGION_ID =
  "release-calendar-month-tabs";
export const RELEASE_CALENDAR_GRID_REGION_ID = "release-calendar-grid";

export const RELEASE_CALENDAR_EMPTY_STATE_ID = "release-calendar-empty-state";

export function getReleaseCalendarMonthTabFocusId(month: string) {
  return `release-calendar-month-tab-${month}`;
}

export function getReleaseCalendarGameCardFocusId(slug: string) {
  return `release-calendar-game-card-${slug}`;
}
