import { CatalogueClassicsCard } from "./classics-card";
import type { CatalogueCardProps } from "./card-shell";
import { CatalogueStandardCard } from "./standard-card";

export function CatalogueCard(props: Readonly<CatalogueCardProps>) {
  if (props.game.shop === "launchbox") {
    return <CatalogueClassicsCard {...props} />;
  }

  return <CatalogueStandardCard {...props} />;
}
