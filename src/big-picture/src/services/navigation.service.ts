export type FocusDirection = "up" | "down" | "left" | "right";
export type FocusOrientation = "vertical" | "horizontal" | "grid";
export type NavigationNodeState = "active" | "disabled" | "hidden";
export type FocusElementGetter = () => HTMLElement | null;
export type FocusOverrideTarget =
  | {
      type: "item";
      itemId: string;
    }
  | {
      type: "region";
      regionId: string;
      entryDirection?: FocusDirection;
    }
  | {
      type: "block";
    };
export type FocusOverrides = Partial<
  Record<FocusDirection, FocusOverrideTarget>
>;

export const ROOT_NAVIGATION_LAYER_ID = "navigation-root-layer";

export interface FocusNode {
  id: string;
  regionId: string;
  layerId: string;
  navigationState: NavigationNodeState;
  navigationOverrides?: FocusOverrides;
  getElement: FocusElementGetter;
}

export interface FocusRegion {
  id: string;
  parentRegionId: string | null;
  orientation: FocusOrientation;
  layerId: string;
  navigationOverrides?: FocusOverrides;
  getElement: FocusElementGetter;
}

export interface FocusLayer {
  id: string;
  rootRegionId: string | null;
  openerFocusId: string | null;
  openerRegionId: string | null;
}

interface FocusRegionRecord extends FocusRegion {
  isPersistent: boolean;
}

interface FocusLayerRecord extends FocusLayer {
  isPersistent: boolean;
  explicitRootRegionId: string | null;
  hasWarnedAboutMultipleRoots: boolean;
}

type Listener = () => void;
type FocusTarget = { type: "node" | "region"; id: string };
type FocusBoundary = "first" | "last";
type PendingInitialFocusRequest = {
  layerId: string;
  initialFocusId?: string;
  initialFocusRegionId?: string;
};

export interface NavigationDebugSnapshot {
  currentFocusId: string | null;
  activeLayerId: string | null;
  nodeCount: number;
  nodeIds: string[];
  regionCount: number;
  regionIds: string[];
  layerCount: number;
  layerIds: string[];
  listenerCount: number;
  lastFocusedByRegionId: Record<string, string>;
  openerFocusByLayerId: Record<string, string | null>;
  openerRegionByLayerId: Record<string, string | null>;
}

export class NavigationService {
  private static instance: NavigationService;

  private readonly nodes = new Map<string, FocusNode>();
  private readonly regions = new Map<string, FocusRegionRecord>();
  private readonly layers = new Map<string, FocusLayerRecord>();
  private layerStack: string[] = [ROOT_NAVIGATION_LAYER_ID];
  private readonly regionChildren = new Map<string, FocusTarget[]>();
  private readonly regionChildOrder = new Map<string, Map<string, number>>();
  private readonly regionChildOrderCounter = new Map<string, number>();
  private currentFocusId: string | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly lastFocusedByRegionId = new Map<string, string>();
  private readonly pendingInitialFocusByLayerId = new Map<
    string,
    PendingInitialFocusRequest
  >();

  public constructor() {
    this.layers.set(ROOT_NAVIGATION_LAYER_ID, {
      id: ROOT_NAVIGATION_LAYER_ID,
      rootRegionId: null,
      openerFocusId: null,
      openerRegionId: null,
      isPersistent: true,
      explicitRootRegionId: null,
      hasWarnedAboutMultipleRoots: false,
    });
  }

  public static getInstance(): NavigationService {
    if (!NavigationService.instance) {
      NavigationService.instance = new NavigationService();
    }

    return NavigationService.instance;
  }

  public registerLayer(layer: {
    id: string;
    rootRegionId?: string | null;
    isPersistent?: boolean;
  }) {
    if (layer.id === ROOT_NAVIGATION_LAYER_ID) {
      throw new Error(
        `Focus layer "${ROOT_NAVIGATION_LAYER_ID}" is reserved for the implicit root layer.`
      );
    }

    const existingLayer = this.layers.get(layer.id);

    if (existingLayer) {
      throw new Error(`Focus layer "${layer.id}" is already registered.`);
    }

    const openerFocusId =
      this.currentFocusId && this.nodes.has(this.currentFocusId)
        ? this.currentFocusId
        : null;

    const openerRegionId = openerFocusId
      ? (this.nodes.get(openerFocusId)?.regionId ?? null)
      : null;

    this.layers.set(layer.id, {
      id: layer.id,
      rootRegionId: layer.rootRegionId ?? null,
      openerFocusId,
      openerRegionId,
      isPersistent: Boolean(layer.isPersistent),
      explicitRootRegionId: layer.rootRegionId ?? null,
      hasWarnedAboutMultipleRoots: false,
    });

    this.layerStack.push(layer.id);
    this.reconcileLayerRootRegion(layer.id);
    this.currentFocusId = null;
    this.notify();

    return () => {
      const registeredLayer = this.layers.get(layer.id);

      if (!registeredLayer) return;

      const wasActiveLayer = this.getActiveLayerId() === layer.id;

      this.layerStack = this.layerStack.filter(
        (stackLayerId) => stackLayerId !== layer.id
      );

      this.pendingInitialFocusByLayerId.delete(layer.id);
      this.layers.delete(layer.id);

      if (wasActiveLayer) {
        this.currentFocusId = this.restoreFocusForLayer(registeredLayer);

        if (this.currentFocusId) {
          this.updateLastFocusedForNode(this.currentFocusId);
        }
      } else if (
        this.currentFocusId &&
        !this.isNodeInActiveLayer(this.currentFocusId)
      ) {
        this.currentFocusId = this.resolveFirstAvailableFocus();

        if (this.currentFocusId) {
          this.updateLastFocusedForNode(this.currentFocusId);
        }
      }

      this.notify();
    };
  }

  public focusInitialInLayer(options: {
    layerId: string;
    initialFocusId?: string;
    initialFocusRegionId?: string;
  }) {
    const layer = this.layers.get(options.layerId);

    if (!layer) return null;

    const request: PendingInitialFocusRequest = {
      layerId: options.layerId,
      initialFocusId: options.initialFocusId,
      initialFocusRegionId: options.initialFocusRegionId,
    };

    const initialFocusId = this.resolvePendingInitialFocusRequest(request);

    if (!initialFocusId) {
      this.pendingInitialFocusByLayerId.set(options.layerId, request);
      return null;
    }

    this.pendingInitialFocusByLayerId.delete(options.layerId);
    this.setFocus(initialFocusId);
    return initialFocusId;
  }

  public registerRegion(
    region: Omit<FocusRegion, "layerId"> & {
      layerId?: string;
      isPersistent?: boolean;
    }
  ) {
    const existingRegion = this.regions.get(region.id);

    if (existingRegion) {
      throw new Error(`Focus region "${region.id}" is already registered.`);
    }

    const layerId = region.layerId ?? ROOT_NAVIGATION_LAYER_ID;

    if (region.parentRegionId) {
      const parentRegion = this.regions.get(region.parentRegionId);

      if (parentRegion && parentRegion.layerId !== layerId) {
        throw new Error(
          `Focus region "${region.id}" must share the same layer as its parent region "${region.parentRegionId}".`
        );
      }
    }

    const regionRecord: FocusRegionRecord = {
      ...region,
      parentRegionId: region.parentRegionId ?? null,
      layerId,
      navigationOverrides: region.navigationOverrides,
      isPersistent: Boolean(region.isPersistent),
    };

    this.regions.set(region.id, regionRecord);
    this.ensureRegionChildren(region.id);

    if (regionRecord.parentRegionId) {
      this.appendChildTarget(regionRecord.parentRegionId, {
        type: "region",
        id: regionRecord.id,
      });
    }

    this.reconcileLayerRootRegion(layerId);
    this.tryResolvePendingInitialFocus(layerId);

    if (
      this.currentFocusId &&
      this.isNodeWithinRegion(this.currentFocusId, region.id)
    ) {
      this.updateLastFocusedForNode(this.currentFocusId);
    }

    this.notify();

    return () => {
      const registeredRegion = this.regions.get(region.id);

      if (!registeredRegion) return;
      const shouldRecoverFocus =
        this.currentFocusId !== null &&
        this.isNodeWithinRegion(this.currentFocusId, region.id);

      if (registeredRegion.parentRegionId) {
        this.removeChildTarget(registeredRegion.parentRegionId, {
          type: "region",
          id: region.id,
        });
      }

      this.regions.delete(region.id);
      this.regionChildren.delete(region.id);
      this.reconcileLayerRootRegion(registeredRegion.layerId);
      this.tryResolvePendingInitialFocus(registeredRegion.layerId);

      if (!registeredRegion.isPersistent) {
        this.regionChildOrder.delete(region.id);
        this.regionChildOrderCounter.delete(region.id);
      }

      if (!registeredRegion.isPersistent) {
        this.lastFocusedByRegionId.delete(region.id);
      }

      if (shouldRecoverFocus) {
        this.currentFocusId =
          (registeredRegion.parentRegionId
            ? this.resolveRecoveryFocus(registeredRegion.parentRegionId)
            : null) ?? this.resolveFirstAvailableFocus();

        if (this.currentFocusId) {
          this.updateLastFocusedForNode(this.currentFocusId);
        }
      }

      this.notify();
    };
  }

  public updateRegion(
    regionId: string,
    updates: Partial<Pick<FocusRegion, "navigationOverrides" | "getElement">>
  ) {
    const registeredRegion = this.regions.get(regionId);

    if (!registeredRegion) return;

    const nextNavigationOverrides =
      updates.navigationOverrides ?? registeredRegion.navigationOverrides;

    const nextGetElement = updates.getElement ?? registeredRegion.getElement;

    if (
      this.areFocusOverridesEqual(
        registeredRegion.navigationOverrides,
        nextNavigationOverrides
      ) &&
      nextGetElement === registeredRegion.getElement
    ) {
      return;
    }

    this.regions.set(regionId, {
      ...registeredRegion,
      navigationOverrides: nextNavigationOverrides,
      getElement: nextGetElement,
    });

    this.notify();
  }

  public registerNavigationNode(
    node: Omit<
      FocusNode,
      "layerId" | "navigationState" | "navigationOverrides"
    > & {
      layerId?: string;
      navigationState?: NavigationNodeState;
      navigationOverrides?: FocusOverrides;
    }
  ) {
    const existingNode = this.nodes.get(node.id);

    if (existingNode) {
      throw new Error(`Focus node "${node.id}" is already registered.`);
    }

    const region = this.regions.get(node.regionId);
    const layerId = node.layerId ?? region?.layerId ?? ROOT_NAVIGATION_LAYER_ID;

    if (region && layerId !== region.layerId) {
      throw new Error(
        `Focus node "${node.id}" must share the same layer as its region "${node.regionId}".`
      );
    }

    this.nodes.set(node.id, {
      id: node.id,
      regionId: node.regionId,
      layerId,
      navigationState: node.navigationState ?? "active",
      navigationOverrides: node.navigationOverrides,
      getElement: node.getElement,
    });
    this.ensureRegionChildren(node.regionId);
    this.appendChildTarget(node.regionId, {
      type: "node",
      id: node.id,
    });

    const resolvedPendingInitialFocus =
      this.tryResolvePendingInitialFocus(layerId);

    if (
      !resolvedPendingInitialFocus &&
      layerId === this.getActiveLayerId() &&
      this.isNodeActive(node.id) &&
      !this.hasValidCurrentFocus() &&
      !this.hasPendingInitialFocus(layerId)
    ) {
      const nextFocusId = this.resolveRecoveryFocus(node.regionId) ?? node.id;

      this.currentFocusId = nextFocusId;
      this.updateLastFocusedForNode(nextFocusId);
    }

    this.notify();

    return () => {
      const registeredNode = this.nodes.get(node.id);

      if (!registeredNode) return;

      this.nodes.delete(node.id);
      this.removeChildTarget(registeredNode.regionId, {
        type: "node",
        id: node.id,
      });

      if (this.currentFocusId === node.id) {
        this.currentFocusId =
          this.resolveRecoveryFocus(registeredNode.regionId) ??
          this.resolveFirstAvailableFocus();

        if (this.currentFocusId) {
          this.updateLastFocusedForNode(this.currentFocusId);
        }
      }

      this.notify();
    };
  }

  public updateNavigationNode(
    nodeId: string,
    updates: Partial<Pick<FocusNode, "navigationState" | "navigationOverrides">>
  ) {
    const registeredNode = this.nodes.get(nodeId);

    if (!registeredNode) return;

    const nextNavigationState =
      updates.navigationState ?? registeredNode.navigationState;
    const nextNavigationOverrides =
      updates.navigationOverrides ?? registeredNode.navigationOverrides;

    if (
      nextNavigationState === registeredNode.navigationState &&
      this.areFocusOverridesEqual(
        registeredNode.navigationOverrides,
        nextNavigationOverrides
      )
    ) {
      return;
    }

    this.nodes.set(nodeId, {
      ...registeredNode,
      navigationState: nextNavigationState,
      navigationOverrides: nextNavigationOverrides,
    });

    const resolvedPendingInitialFocus = this.tryResolvePendingInitialFocus(
      registeredNode.layerId
    );

    if (this.currentFocusId === nodeId && !this.isNodeActive(nodeId)) {
      this.currentFocusId =
        this.resolveRecoveryFocus(registeredNode.regionId) ??
        this.resolveFirstAvailableFocus();

      if (this.currentFocusId) {
        this.updateLastFocusedForNode(this.currentFocusId);
      }
    } else if (
      !resolvedPendingInitialFocus &&
      this.isNodeActive(nodeId) &&
      registeredNode.layerId === this.getActiveLayerId() &&
      !this.hasValidCurrentFocus() &&
      !this.hasPendingInitialFocus(registeredNode.layerId)
    ) {
      const nextFocusId =
        this.resolveRecoveryFocus(registeredNode.regionId) ?? nodeId;

      this.currentFocusId = nextFocusId;
      this.updateLastFocusedForNode(nextFocusId);
    }

    this.notify();
  }

  public getCurrentFocusId(): string | null {
    return this.currentFocusId;
  }

  public getNode(id: string): FocusNode | null {
    return this.nodes.get(id) ?? null;
  }

  public isNodeActive(nodeId: string) {
    return this.nodes.get(nodeId)?.navigationState === "active";
  }

  public getActiveLayerId(): string | null {
    return this.layerStack.at(-1) ?? null;
  }

  public getNodes(): FocusNode[] {
    return Array.from(this.nodes.values());
  }

  public getRegions(): FocusRegion[] {
    return Array.from(this.regions.values()).map((region) => ({
      id: region.id,
      parentRegionId: region.parentRegionId,
      orientation: region.orientation,
      layerId: region.layerId,
      navigationOverrides: region.navigationOverrides,
      getElement: region.getElement,
    }));
  }

  public getLayers(): FocusLayer[] {
    return this.layerStack
      .map((layerId) => this.layers.get(layerId))
      .filter((layer): layer is FocusLayerRecord => Boolean(layer))
      .map((layer) => ({
        id: layer.id,
        rootRegionId: layer.rootRegionId,
        openerFocusId: layer.openerFocusId,
        openerRegionId: layer.openerRegionId,
      }));
  }

  public setFocus(id: string) {
    const node = this.nodes.get(id);

    if (!node) return null;
    if (!this.isNodeActive(id)) return null;
    if (!this.isNodeInActiveLayer(id)) return null;
    if (this.currentFocusId === id) return id;

    this.currentFocusId = node.id;
    this.updateLastFocusedForNode(node.id);
    this.notify();
    return node.id;
  }

  public setFocusRegion(
    regionId: string,
    entryDirection: FocusDirection = "right"
  ) {
    const region = this.regions.get(regionId);

    if (!region) return null;

    if (!this.isRegionInActiveLayer(regionId)) {
      return null;
    }

    if (
      this.currentFocusId !== null &&
      this.isNodeWithinRegion(this.currentFocusId, regionId)
    ) {
      return this.currentFocusId;
    }

    const nextNodeId = this.getEntryNodeForRegion(regionId, entryDirection);

    if (!nextNodeId) return null;

    return this.setFocus(nextNodeId);
  }

  public moveFocus(direction: FocusDirection) {
    if (!this.ensureCurrentFocus()) return null;

    const currentNodeId = this.currentFocusId;

    if (!currentNodeId) return null;

    const currentNode = this.nodes.get(currentNodeId);

    if (!currentNode) return null;

    const nodeOverride = currentNode.navigationOverrides?.[direction];

    if (nodeOverride) {
      if (nodeOverride.type === "block") {
        return currentNodeId;
      }

      const overrideNodeId = this.resolveOverrideTargetToNode(
        nodeOverride,
        direction
      );

      if (overrideNodeId) {
        return this.setFocus(overrideNodeId);
      }

      this.warnInvalidOverride({
        sourceType: "item",
        sourceId: currentNodeId,
        direction,
        target: nodeOverride,
      });

      return this.moveFocusByTree(currentNodeId, direction);
    }

    let currentRegionId: string | null = currentNode.regionId;

    while (currentRegionId) {
      const currentRegion = this.regions.get(currentRegionId);

      if (currentRegion?.layerId !== this.getActiveLayerId()) {
        break;
      }
      const regionOverride = currentRegion.navigationOverrides?.[direction];

      if (regionOverride) {
        if (regionOverride.type === "block") {
          return currentNodeId;
        }

        const overrideNodeId = this.resolveOverrideTargetToNode(
          regionOverride,
          direction
        );

        if (overrideNodeId) {
          return this.setFocus(overrideNodeId);
        }

        this.warnInvalidOverride({
          sourceType: "region",
          sourceId: currentRegionId,
          direction,
          target: regionOverride,
        });

        return this.moveFocusByTree(currentNodeId, direction);
      }

      currentRegionId = currentRegion.parentRegionId ?? null;
    }

    return this.moveFocusByTree(currentNodeId, direction);
  }

  public getDebugSnapshot(): NavigationDebugSnapshot {
    const layers = this.getLayers();

    return {
      currentFocusId: this.currentFocusId,
      activeLayerId: this.getActiveLayerId(),
      nodeCount: this.nodes.size,
      nodeIds: Array.from(this.nodes.keys()),
      regionCount: this.regions.size,
      regionIds: Array.from(this.regions.keys()),
      layerCount: layers.length,
      layerIds: layers.map((layer) => layer.id),
      listenerCount: this.listeners.size,
      lastFocusedByRegionId: Object.fromEntries(this.lastFocusedByRegionId),
      openerFocusByLayerId: Object.fromEntries(
        layers.map((layer) => [layer.id, layer.openerFocusId])
      ),
      openerRegionByLayerId: Object.fromEntries(
        layers.map((layer) => [layer.id, layer.openerRegionId])
      ),
    };
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private resolveInitialFocusInLayer(options: {
    layerId: string;
    rootRegionId: string | null;
    initialFocusId?: string;
    initialFocusRegionId?: string;
  }) {
    if (
      options.initialFocusId &&
      this.nodes.has(options.initialFocusId) &&
      this.isNodeActive(options.initialFocusId) &&
      this.isNodeInLayer(options.initialFocusId, options.layerId)
    ) {
      return options.initialFocusId;
    }

    if (
      options.initialFocusRegionId &&
      this.regions.has(options.initialFocusRegionId) &&
      this.isRegionInLayer(options.initialFocusRegionId, options.layerId)
    ) {
      return this.getEntryNodeForRegion(options.initialFocusRegionId, "right");
    }

    if (
      options.rootRegionId &&
      this.regions.has(options.rootRegionId) &&
      this.isRegionInLayer(options.rootRegionId, options.layerId)
    ) {
      return this.getBoundaryNodeInRegion(options.rootRegionId, "first");
    }

    return null;
  }

  private resolvePendingInitialFocusRequest(
    request: PendingInitialFocusRequest
  ) {
    const layer = this.layers.get(request.layerId);

    if (!layer) return null;

    return this.resolveInitialFocusInLayer({
      layerId: request.layerId,
      rootRegionId: layer.rootRegionId,
      initialFocusId: request.initialFocusId,
      initialFocusRegionId: request.initialFocusRegionId,
    });
  }

  private restoreFocusForLayer(layer: FocusLayerRecord) {
    const nextActiveLayerId = this.getActiveLayerId();

    if (
      layer.openerFocusId &&
      this.nodes.has(layer.openerFocusId) &&
      this.isNodeActive(layer.openerFocusId) &&
      this.isNodeInActiveLayer(layer.openerFocusId)
    ) {
      return layer.openerFocusId;
    }

    if (
      layer.openerRegionId &&
      this.regions.has(layer.openerRegionId) &&
      nextActiveLayerId !== null &&
      this.isRegionInLayer(layer.openerRegionId, nextActiveLayerId)
    ) {
      return this.getEntryNodeForRegion(layer.openerRegionId, "right");
    }

    return this.resolveFirstAvailableFocus();
  }

  private ensureRegionChildren(regionId: string) {
    if (!this.regionChildren.has(regionId)) {
      this.regionChildren.set(regionId, []);
    }

    if (!this.regionChildOrder.has(regionId)) {
      this.regionChildOrder.set(regionId, new Map());
    }

    if (!this.regionChildOrderCounter.has(regionId)) {
      this.regionChildOrderCounter.set(regionId, 0);
    }
  }

  private appendChildTarget(regionId: string, target: FocusTarget) {
    this.ensureRegionChildren(regionId);

    const children = this.regionChildren.get(regionId);
    const childOrder = this.regionChildOrder.get(regionId);

    if (!children || !childOrder) return;

    const alreadyRegistered = children.some(
      (child) => child.type === target.type && child.id === target.id
    );

    if (alreadyRegistered) return;

    const targetKey = this.getTargetKey(target);

    if (!childOrder.has(targetKey)) {
      const nextOrder = this.regionChildOrderCounter.get(regionId) ?? 0;

      childOrder.set(targetKey, nextOrder);
      this.regionChildOrderCounter.set(regionId, nextOrder + 1);
    }

    const targetOrder = childOrder.get(targetKey) ?? 0;
    const insertIndex = children.findIndex((child) => {
      const childKey = this.getTargetKey(child);
      const childTargetOrder = childOrder.get(childKey) ?? 0;

      return childTargetOrder > targetOrder;
    });

    if (insertIndex === -1) {
      children.push(target);
      return;
    }

    children.splice(insertIndex, 0, target);
  }

  private removeChildTarget(regionId: string, target: FocusTarget) {
    const children = this.regionChildren.get(regionId);

    if (!children) return;

    const nextChildren = children.filter(
      (child) => !(child.type === target.type && child.id === target.id)
    );

    this.regionChildren.set(regionId, nextChildren);
  }

  private getTargetKey(target: FocusTarget) {
    return `${target.type}:${target.id}`;
  }

  private hasPendingInitialFocus(layerId: string) {
    return this.pendingInitialFocusByLayerId.has(layerId);
  }

  private reconcileLayerRootRegion(layerId: string) {
    if (layerId === ROOT_NAVIGATION_LAYER_ID) {
      return;
    }

    const layer = this.layers.get(layerId);

    if (!layer) return;

    const nextRootRegionId = this.getEffectiveRootRegionIdForLayer(layer);
    const topLevelRegionIds = this.getTopLevelRegionIdsForLayer(layerId);
    const shouldWarnAboutMultipleRoots =
      layer.explicitRootRegionId === null && topLevelRegionIds.length > 1;

    if (
      shouldWarnAboutMultipleRoots &&
      !layer.hasWarnedAboutMultipleRoots &&
      process.env.NODE_ENV !== "production"
    ) {
      console.warn(
        `Navigation layer "${layerId}" registered multiple root regions without an explicit rootRegionId. Using "${topLevelRegionIds[0]}" as the effective root region. Prefer a single root region or pass rootRegionId explicitly to avoid ambiguous layer structure.`,
        {
          layerId,
          topLevelRegionIds,
          effectiveRootRegionId: topLevelRegionIds[0] ?? null,
        }
      );
    }

    if (
      layer.rootRegionId === nextRootRegionId &&
      layer.hasWarnedAboutMultipleRoots === shouldWarnAboutMultipleRoots
    ) {
      return;
    }

    this.layers.set(layerId, {
      ...layer,
      rootRegionId: nextRootRegionId,
      hasWarnedAboutMultipleRoots: shouldWarnAboutMultipleRoots,
    });
  }

  private tryResolvePendingInitialFocus(layerId: string) {
    if (layerId !== this.getActiveLayerId()) {
      return false;
    }

    const request = this.pendingInitialFocusByLayerId.get(layerId);

    if (!request) return false;

    const nextFocusId = this.resolvePendingInitialFocusRequest(request);

    if (!nextFocusId) return false;

    this.pendingInitialFocusByLayerId.delete(layerId);
    this.setFocus(nextFocusId);
    return true;
  }

  private getTopLevelRegionIdsForLayer(layerId: string) {
    return Array.from(this.regions.values())
      .filter(
        (region) => region.layerId === layerId && region.parentRegionId === null
      )
      .map((region) => region.id);
  }

  private getEffectiveRootRegionIdForLayer(layer: FocusLayerRecord) {
    if (
      layer.explicitRootRegionId !== null &&
      this.regions.has(layer.explicitRootRegionId)
    ) {
      return layer.explicitRootRegionId;
    }

    if (layer.explicitRootRegionId !== null) {
      return null;
    }

    return this.getTopLevelRegionIdsForLayer(layer.id)[0] ?? null;
  }

  private hasValidCurrentFocus() {
    return (
      this.currentFocusId !== null &&
      this.nodes.has(this.currentFocusId) &&
      this.isNodeActive(this.currentFocusId) &&
      this.isNodeInActiveLayer(this.currentFocusId)
    );
  }

  private ensureCurrentFocus() {
    if (this.hasValidCurrentFocus()) return true;

    this.currentFocusId = this.resolveFirstAvailableFocus();

    if (this.currentFocusId) {
      this.updateLastFocusedForNode(this.currentFocusId);
      this.notify();
      return true;
    }

    return false;
  }

  private updateLastFocusedForNode(nodeId: string) {
    const node = this.nodes.get(nodeId);

    if (!node) return;

    let regionId: string | null = node.regionId;

    while (regionId) {
      this.lastFocusedByRegionId.set(regionId, nodeId);
      regionId = this.regions.get(regionId)?.parentRegionId ?? null;
    }
  }

  private resolveRecoveryFocus(regionId: string): string | null {
    let currentRegionId: string | null = regionId;

    while (currentRegionId) {
      const region = this.regions.get(currentRegionId);

      if (region?.layerId !== this.getActiveLayerId()) {
        return null;
      }

      const recoveryNodeId = this.getBoundaryNodeInRegion(
        currentRegionId,
        "first"
      );

      if (recoveryNodeId) {
        return recoveryNodeId;
      }

      currentRegionId = region.parentRegionId ?? null;
    }

    return null;
  }

  private resolveFirstAvailableFocus(): string | null {
    const activeLayerId = this.getActiveLayerId();
    const activeLayer = activeLayerId ? this.layers.get(activeLayerId) : null;

    if (
      activeLayer?.rootRegionId &&
      this.regions.has(activeLayer.rootRegionId)
    ) {
      const nodeId = this.getBoundaryNodeInRegion(
        activeLayer.rootRegionId,
        "first"
      );

      if (nodeId) return nodeId;
    }

    for (const region of this.regions.values()) {
      if (region.layerId !== activeLayerId || region.parentRegionId !== null) {
        continue;
      }

      const nodeId = this.getBoundaryNodeInRegion(region.id, "first");

      if (nodeId) return nodeId;
    }

    for (const node of this.nodes.values()) {
      if (node.layerId === activeLayerId && this.isNodeActive(node.id)) {
        return node.id;
      }
    }

    return null;
  }

  private moveFocusByTree(
    currentNodeId: string,
    direction: FocusDirection
  ): string | null {
    const currentNode = this.nodes.get(currentNodeId);

    if (!currentNode) return null;

    let currentRegionId: string | null = currentNode.regionId;

    while (currentRegionId) {
      const currentRegion = this.regions.get(currentRegionId);

      if (currentRegion?.layerId !== this.getActiveLayerId()) {
        break;
      }

      const nextNodeId = this.getNextNodeInRegion(
        currentRegionId,
        currentNodeId,
        direction
      );

      if (nextNodeId) {
        return this.setFocus(nextNodeId);
      }

      currentRegionId = currentRegion.parentRegionId ?? null;
    }

    return null;
  }

  private getNextNodeInRegion(
    regionId: string,
    currentNodeId: string,
    direction: FocusDirection
  ): string | null {
    const region = this.regions.get(regionId);

    if (!region) return null;
    if (region.layerId !== this.getActiveLayerId()) return null;

    if (region.orientation === "grid") {
      return this.getNextNodeInGridRegion(regionId, currentNodeId, direction);
    }

    if (!this.doesDirectionMatchOrientation(direction, region.orientation)) {
      return null;
    }

    const children = this.regionChildren.get(regionId) ?? [];
    const currentTarget = this.getDirectChildTargetForNode(
      regionId,
      currentNodeId
    );

    if (!currentTarget) return null;

    const currentIndex = children.findIndex(
      (child) =>
        child.type === currentTarget.type && child.id === currentTarget.id
    );

    if (currentIndex === -1) return null;

    const step = this.getDirectionStep(direction);

    for (
      let index = currentIndex + step;
      index >= 0 && index < children.length;
      index += step
    ) {
      const candidateNodeId = this.resolveTargetToNode(
        children[index],
        direction
      );

      if (candidateNodeId) {
        return candidateNodeId;
      }
    }

    return null;
  }

  private getNextNodeInGridRegion(
    regionId: string,
    currentNodeId: string,
    direction: FocusDirection
  ): string | null {
    const children = this.regionChildren.get(regionId) ?? [];
    const currentTarget = this.getDirectChildTargetForNode(
      regionId,
      currentNodeId
    );

    if (!currentTarget) return null;

    const currentRect = this.getTargetRect(currentTarget);

    if (!currentRect) return null;

    const candidates = children
      .filter(
        (child) =>
          !(child.type === currentTarget.type && child.id === currentTarget.id)
      )
      .map((child) => {
        const nodeId = this.resolveTargetToNode(child, direction);
        const rect = this.getTargetRect(child);

        if (!nodeId || !rect) {
          return null;
        }

        return {
          nodeId,
          rect,
          score: this.getGridCandidateScore(currentRect, rect, direction),
        };
      })
      .filter(
        (
          candidate
        ): candidate is {
          nodeId: string;
          rect: DOMRect;
          score: { overlap: number; primary: number; cross: number };
        } => candidate !== null
      )
      .sort((a, b) => {
        if (a.score.overlap !== b.score.overlap) {
          return b.score.overlap - a.score.overlap;
        }

        if (a.score.primary !== b.score.primary) {
          return a.score.primary - b.score.primary;
        }

        return a.score.cross - b.score.cross;
      });

    return candidates[0]?.nodeId ?? null;
  }

  private getTargetRect(target: FocusTarget): DOMRect | null {
    const element = this.getTargetElement(target);

    return element?.getBoundingClientRect() ?? null;
  }

  private getTargetElement(target: FocusTarget): HTMLElement | null {
    if (target.type === "node") {
      return this.nodes.get(target.id)?.getElement?.() ?? null;
    }

    const regionElement = this.regions.get(target.id)?.getElement?.() ?? null;

    if (regionElement) {
      return regionElement;
    }

    const fallbackNodeId = this.getBoundaryNodeInRegion(target.id, "first");

    return fallbackNodeId
      ? (this.nodes.get(fallbackNodeId)?.getElement?.() ?? null)
      : null;
  }

  private getGridCandidateScore(
    currentRect: DOMRect,
    candidateRect: DOMRect,
    direction: FocusDirection
  ) {
    switch (direction) {
      case "left": {
        const primary = currentRect.left - candidateRect.right;

        if (primary < 0) return null;

        return {
          overlap: this.getAxisOverlap(
            currentRect.top,
            currentRect.bottom,
            candidateRect.top,
            candidateRect.bottom
          ),
          primary,
          cross: Math.abs(
            this.getRectCenter(currentRect).y -
              this.getRectCenter(candidateRect).y
          ),
        };
      }
      case "right": {
        const primary = candidateRect.left - currentRect.right;

        if (primary < 0) return null;

        return {
          overlap: this.getAxisOverlap(
            currentRect.top,
            currentRect.bottom,
            candidateRect.top,
            candidateRect.bottom
          ),
          primary,
          cross: Math.abs(
            this.getRectCenter(currentRect).y -
              this.getRectCenter(candidateRect).y
          ),
        };
      }
      case "up": {
        const primary = currentRect.top - candidateRect.bottom;

        if (primary < 0) return null;

        return {
          overlap: this.getAxisOverlap(
            currentRect.left,
            currentRect.right,
            candidateRect.left,
            candidateRect.right
          ),
          primary,
          cross: Math.abs(
            this.getRectCenter(currentRect).x -
              this.getRectCenter(candidateRect).x
          ),
        };
      }
      case "down": {
        const primary = candidateRect.top - currentRect.bottom;

        if (primary < 0) return null;

        return {
          overlap: this.getAxisOverlap(
            currentRect.left,
            currentRect.right,
            candidateRect.left,
            candidateRect.right
          ),
          primary,
          cross: Math.abs(
            this.getRectCenter(currentRect).x -
              this.getRectCenter(candidateRect).x
          ),
        };
      }
    }
  }

  private getAxisOverlap(
    startA: number,
    endA: number,
    startB: number,
    endB: number
  ) {
    return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
  }

  private getRectCenter(rect: DOMRect) {
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  private resolveTargetToNode(
    target: FocusTarget,
    direction: FocusDirection
  ): string | null {
    if (target.type === "node") {
      return this.isNodeInActiveLayer(target.id) && this.isNodeActive(target.id)
        ? target.id
        : null;
    }

    return this.getEntryNodeForRegion(target.id, direction);
  }

  private resolveOverrideTargetToNode(
    target: FocusOverrideTarget,
    direction: FocusDirection
  ): string | null {
    if (target.type === "item") {
      return this.resolveItemOverrideTarget(target.itemId);
    }

    if (target.type === "block") {
      return null;
    }

    return this.resolveRegionOverrideTarget(
      target.regionId,
      target.entryDirection ?? direction
    );
  }

  private resolveItemOverrideTarget(itemId: string): string | null {
    if (!this.nodes.has(itemId)) {
      return null;
    }

    if (!this.isNodeInActiveLayer(itemId)) {
      return null;
    }

    if (!this.isNodeActive(itemId)) {
      return null;
    }

    return itemId;
  }

  private resolveRegionOverrideTarget(
    regionId: string,
    direction: FocusDirection
  ): string | null {
    if (!this.regions.has(regionId)) {
      return null;
    }

    if (!this.isRegionInActiveLayer(regionId)) {
      return null;
    }

    return this.getEntryNodeForRegion(regionId, direction);
  }

  private getEntryNodeForRegion(
    regionId: string,
    direction: FocusDirection
  ): string | null {
    if (!this.isRegionInActiveLayer(regionId)) {
      return null;
    }

    const rememberedNodeId = this.lastFocusedByRegionId.get(regionId);

    if (
      rememberedNodeId &&
      this.nodes.has(rememberedNodeId) &&
      this.isNodeActive(rememberedNodeId) &&
      this.isNodeWithinRegion(rememberedNodeId, regionId) &&
      this.isNodeInActiveLayer(rememberedNodeId)
    ) {
      return rememberedNodeId;
    }

    return this.getBoundaryNodeInRegion(
      regionId,
      this.getBoundaryForEntryDirection(direction)
    );
  }

  private getBoundaryNodeInRegion(
    regionId: string,
    boundary: FocusBoundary
  ): string | null {
    const region = this.regions.get(regionId);

    if (region?.layerId !== this.getActiveLayerId()) {
      return null;
    }

    const children = this.regionChildren.get(regionId) ?? [];
    const orderedChildren =
      boundary === "first" ? children : [...children].reverse();

    for (const child of orderedChildren) {
      if (
        child.type === "node" &&
        this.isNodeInActiveLayer(child.id) &&
        this.isNodeActive(child.id)
      ) {
        return child.id;
      }

      if (child.type === "region") {
        const descendantNodeId = this.getBoundaryNodeInRegion(
          child.id,
          boundary
        );

        if (descendantNodeId) {
          return descendantNodeId;
        }
      }
    }

    return null;
  }

  private getDirectChildTargetForNode(
    regionId: string,
    nodeId: string
  ): FocusTarget | null {
    const node = this.nodes.get(nodeId);

    if (!node) return null;

    if (node.regionId === regionId) {
      return {
        type: "node",
        id: nodeId,
      };
    }

    let currentRegionId: string | null = node.regionId;

    while (currentRegionId) {
      const currentRegion = this.regions.get(currentRegionId);

      if (!currentRegion) return null;

      if (currentRegion.parentRegionId === regionId) {
        return {
          type: "region",
          id: currentRegionId,
        };
      }

      currentRegionId = currentRegion.parentRegionId;
    }

    return null;
  }

  private isNodeWithinRegion(nodeId: string, regionId: string): boolean {
    const node = this.nodes.get(nodeId);

    if (!node) return false;

    let currentRegionId: string | null = node.regionId;

    while (currentRegionId) {
      if (currentRegionId === regionId) {
        return true;
      }

      currentRegionId =
        this.regions.get(currentRegionId)?.parentRegionId ?? null;
    }

    return false;
  }

  private isNodeInLayer(nodeId: string, layerId: string) {
    return this.nodes.get(nodeId)?.layerId === layerId;
  }

  private isNodeInActiveLayer(nodeId: string) {
    const activeLayerId = this.getActiveLayerId();

    return activeLayerId ? this.isNodeInLayer(nodeId, activeLayerId) : false;
  }

  private isRegionInLayer(regionId: string, layerId: string) {
    return this.regions.get(regionId)?.layerId === layerId;
  }

  private isRegionInActiveLayer(regionId: string) {
    const activeLayerId = this.getActiveLayerId();

    return activeLayerId
      ? this.isRegionInLayer(regionId, activeLayerId)
      : false;
  }

  private doesDirectionMatchOrientation(
    direction: FocusDirection,
    orientation: FocusOrientation
  ) {
    const isVerticalDirection = direction === "up" || direction === "down";

    return isVerticalDirection
      ? orientation === "vertical"
      : orientation === "horizontal";
  }

  private getDirectionStep(direction: FocusDirection) {
    return direction === "up" || direction === "left" ? -1 : 1;
  }

  private getBoundaryForEntryDirection(
    direction: FocusDirection
  ): FocusBoundary {
    return direction === "right" || direction === "down" ? "first" : "last";
  }

  private areFocusOverridesEqual(
    left?: FocusOverrides,
    right?: FocusOverrides
  ) {
    const directions: FocusDirection[] = ["up", "down", "left", "right"];

    return directions.every((direction) =>
      this.areFocusOverrideTargetsEqual(left?.[direction], right?.[direction])
    );
  }

  private areFocusOverrideTargetsEqual(
    left?: FocusOverrideTarget,
    right?: FocusOverrideTarget
  ) {
    if (!left && !right) {
      return true;
    }

    if (!left || !right) {
      return false;
    }

    if (left.type !== right.type) {
      return false;
    }

    if (left.type === "item" && right.type === "item") {
      return left.itemId === right.itemId;
    }

    if (left.type === "region" && right.type === "region") {
      return (
        left.regionId === right.regionId &&
        left.entryDirection === right.entryDirection
      );
    }

    if (left.type === "block" && right.type === "block") {
      return true;
    }

    return false;
  }

  private warnInvalidOverride(options: {
    sourceType: "item" | "region";
    sourceId: string;
    direction: FocusDirection;
    target: FocusOverrideTarget;
  }) {
    if (process.env.NODE_ENV === "production") {
      return;
    }

    const reason = this.getOverrideFailureReason(
      options.target,
      options.direction
    );

    console.warn(
      `Navigation override could not resolve for ${options.sourceType} "${options.sourceId}" on "${options.direction}". Falling back to tree navigation because ${reason}.`,
      {
        sourceType: options.sourceType,
        sourceId: options.sourceId,
        direction: options.direction,
        target: options.target,
        activeLayerId: this.getActiveLayerId(),
        currentFocusId: this.currentFocusId,
      }
    );
  }

  private getOverrideFailureReason(
    target: FocusOverrideTarget,
    direction: FocusDirection
  ) {
    if (target.type === "block") {
      return "direction is explicitly blocked";
    }

    if (target.type === "item") {
      if (!this.nodes.has(target.itemId)) {
        return `item target "${target.itemId}" is not registered`;
      }

      if (!this.isNodeInActiveLayer(target.itemId)) {
        return `item target "${target.itemId}" is outside the active layer`;
      }

      if (!this.isNodeActive(target.itemId)) {
        return `item target "${target.itemId}" is not active`;
      }

      return `item target "${target.itemId}" could not be focused`;
    }

    if (!this.regions.has(target.regionId)) {
      return `region target "${target.regionId}" is not registered`;
    }

    if (!this.isRegionInActiveLayer(target.regionId)) {
      return `region target "${target.regionId}" is outside the active layer`;
    }

    const resolvedNodeId = this.getEntryNodeForRegion(
      target.regionId,
      target.entryDirection ?? direction
    );

    if (!resolvedNodeId) {
      return `region target "${target.regionId}" has no active entry node`;
    }

    return `region target "${target.regionId}" could not be focused`;
  }

  private notify() {
    this.listeners.forEach((listener) => listener());
  }
}
