import { FocusItem, Typography, VerticalFocusGroup } from "../../components";
import {
  CATALOGUE_PAGE_REGION_ID,
  CATALOGUE_PAGE_TEXT_ID,
} from "./navigation";
import "./page.scss";

export default function Catalogue() {
  return (
    <VerticalFocusGroup regionId={CATALOGUE_PAGE_REGION_ID} asChild>
      <section className="catalogue-placeholder-page">
        <FocusItem id={CATALOGUE_PAGE_TEXT_ID} asChild>
          <div className="catalogue-placeholder-page__content">
            <Typography variant="h1">Catalogue</Typography>
          </div>
        </FocusItem>
      </section>
    </VerticalFocusGroup>
  );
}
