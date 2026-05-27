import { HorizontalFocusGroup } from "../../components";
import { useHeaderTitle } from "../../hooks";
import {
  CATALOGUE_PAGE_REGION_ID,
} from "./navigation";
import { CatalogueGrid } from "./grid";
import { CatalogueHeader } from "./header";
import { CatalogueSidebar } from "./sidebar";
import { useCatalogueData } from "./use-catalogue-data";
import "./page.scss";

export default function Catalogue() {
  useHeaderTitle("Catalogue");

  const { values, updateSearchParams, catalogueData, search } =
    useCatalogueData();

  if (!catalogueData) return null;

  return (
    <HorizontalFocusGroup regionId={CATALOGUE_PAGE_REGION_ID} asChild>
      <section className="catalogue-page">
        <div className="catalogue-container">
          <CatalogueHeader
            values={values}
            updateSearchParams={updateSearchParams}
            catalogueData={catalogueData}
          />

          <div className="catalogue-content">
            <CatalogueGrid search={search} />

            <CatalogueSidebar
              catalogueData={catalogueData}
              values={values}
              updateSearchParams={updateSearchParams}
            />
          </div>
        </div>
      </section>
    </HorizontalFocusGroup>
  );
}

