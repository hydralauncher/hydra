import assert from "node:assert/strict";
import { it } from "node:test";

import { NavigationService } from "../services/navigation.service.js";
import { getNavigationSnapshot } from "./navigation-snapshot.js";

const getElement = () => null;

const registerRegion = (navigation: NavigationService, id: string) =>
  navigation.registerRegion({
    id,
    parentRegionId: null,
    orientation: "horizontal",
    getElement,
  });

const registerNode = (
  navigation: NavigationService,
  id: string,
  regionId: string
) => navigation.registerNavigationNode({ id, regionId, getElement });

const createNavigation = () => {
  const navigation = new NavigationService();

  registerRegion(navigation, "region");
  registerNode(navigation, "first", "region");
  registerNode(navigation, "second", "region");

  return navigation;
};

it("reuses structural arrays when only the focus changes", () => {
  const navigation = createNavigation();
  const previous = getNavigationSnapshot(navigation);

  navigation.setFocus("second");

  const next = getNavigationSnapshot(navigation, previous);

  assert.equal(next.currentFocusId, "second");
  assert.equal(next.nodes, previous.nodes);
  assert.equal(next.regions, previous.regions);
  assert.equal(next.layers, previous.layers);
  assert.equal(next.debugSnapshot.currentFocusId, "second");
});

it("rebuilds structural arrays when a node is registered", () => {
  const navigation = createNavigation();
  const previous = getNavigationSnapshot(navigation);

  registerNode(navigation, "third", "region");

  const next = getNavigationSnapshot(navigation, previous);

  assert.notEqual(next.nodes, previous.nodes);
  assert.deepEqual(
    next.nodes.map((node) => node.id),
    ["first", "second", "third"]
  );
});

it("rebuilds structural arrays when a node is updated or removed", () => {
  const navigation = new NavigationService();

  registerRegion(navigation, "region");
  const unregister = registerNode(navigation, "node", "region");
  const initial = getNavigationSnapshot(navigation);

  navigation.updateNavigationNode("node", { navigationState: "disabled" });
  const updated = getNavigationSnapshot(navigation, initial);

  assert.notEqual(updated.nodes, initial.nodes);
  assert.equal(updated.nodes[0]?.navigationState, "disabled");

  unregister();
  const removed = getNavigationSnapshot(navigation, updated);

  assert.notEqual(removed.nodes, updated.nodes);
  assert.equal(removed.nodes.length, 0);
});

it("keeps the structure version when an update changes nothing", () => {
  const navigation = createNavigation();
  const version = navigation.getStructureVersion();

  navigation.updateNavigationNode("first", { navigationState: "active" });
  navigation.updateRegion("region", {});

  assert.equal(navigation.getStructureVersion(), version);
});
