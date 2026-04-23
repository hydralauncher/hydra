import { GamepadLayout, getGamepadLayout } from "../helpers";
import type {
  GamepadAxisButtonMapping,
  GamepadAxisTriggerMapping,
  GamepadInputMapping,
  GamepadPhysicalAxisMapping,
} from "../helpers";
import {
  GamepadAxisType,
  GamepadButtonType,
  GamepadAxisDirection,
  GamepadStickSide,
  GamepadButtonPressEvent,
  GamepadStickMoveEvent,
  GamepadInputEventMeta,
} from "../types";

export interface ButtonRawState {
  pressed: boolean;
  value: number;
  lastUpdated: number;
}

export interface AxisRawState {
  value: number;
  lastUpdated: number;
}

export interface GamepadRawState {
  name: string;
  layout: string;
  buttons: Map<GamepadButtonType, ButtonRawState>;
  axes: Map<GamepadAxisType, AxisRawState>;
}

interface GamepadStickState {
  position: Vector2D;
  direction: GamepadAxisDirection | null;
  repeatTimer: number | null;
  lastMoveTime: number;
}

type GamepadStickStateSet = Record<GamepadStickSide, GamepadStickState>;
type GamepadRegistry = Map<number, globalThis.Gamepad>;
type ButtonPressCallback = (event: GamepadButtonPressEvent) => void;
type StickMoveCallback = (event: GamepadStickMoveEvent) => void;
type ButtonPressCallbacks = Map<GamepadButtonType, Set<ButtonPressCallback>>;
type StickMoveCallbacks = Map<
  GamepadStickSide,
  Map<GamepadAxisDirection, Set<StickMoveCallback>>
>;
type GamepadInputDescriptor =
  | {
      kind: "button";
      button: GamepadButtonType;
    }
  | {
      kind: "stick";
      side: GamepadStickSide;
      direction: GamepadAxisDirection;
    };
type GamepadEchoRecord = {
  gamepadIndex: number;
  hardwareKey: string;
  signatureKey: string;
  acceptedAt: number;
};
type DpadRepeatTimers = Map<GamepadButtonType, number>;
type StickPosition = { x: number; y: number };
type StickPositions = Record<GamepadStickSide, StickPosition>;

export class GamepadService {
  private static instance: GamepadService;

  private readonly sticksDeadzone = 0.1;
  private readonly sticksDirectionThreshold = 0.5;
  private readonly sticksInitialRepeatDelay = 400;
  private readonly repeatWarmupInterval = 200;
  private readonly repeatWarmupTicks = 3;
  private readonly repeatAcceleratedStartInterval = 135;
  private readonly repeatMinInterval = 75;
  private readonly repeatAccelerationStep = 15;
  private readonly gamepadSwitchDuplicateWindow = 250;
  private readonly buttonEchoSuppressionWindow = 220;
  private readonly stickEchoSuppressionWindow = 320;
  private readonly axisButtonThreshold = 0.5;
  private readonly axisTriggerThreshold = 0.5;

  private isPolling = false;
  private animationFrameId: number | null = null;
  private activeGamepadIndex: number | null = null;
  private lastActiveGamepadSwitchTime = 0;
  private hasPendingActiveGamepadChange = false;

  private readonly gamepads: GamepadRegistry = new Map();
  private readonly gamepadStates = new Map<number, GamepadRawState>();
  private readonly buttonPressCallbacks: ButtonPressCallbacks = new Map();
  private readonly stickMoveCallbacks: StickMoveCallbacks = new Map();
  private readonly layoutCache = new Map<string, GamepadLayout>();
  private readonly stateChangeCallbacks = new Set<() => void>();
  private readonly stickStatesByGamepad = new Map<
    number,
    GamepadStickStateSet
  >();
  private readonly dpadRepeatTimersByGamepad = new Map<
    number,
    DpadRepeatTimers
  >();
  private recentAcceptedInputs: GamepadEchoRecord[] = [];

  public static getInstance(): GamepadService {
    if (!GamepadService.instance) {
      GamepadService.instance = new GamepadService();
    }

    return GamepadService.instance;
  }

  constructor() {
    if (!this.isWindowAvailable()) return;

    this.setupListeners();
  }

  private isWindowAvailable() {
    return typeof globalThis.window !== "undefined";
  }

  private setupListeners() {
    globalThis.window.addEventListener(
      "gamepadconnected",
      this.handleNewGamepadConnection
    );

    globalThis.window.addEventListener(
      "gamepaddisconnected",
      this.handleGamepadDisconnection
    );
  }

  private createInitialStickState(): GamepadStickState {
    return {
      position: new Vector2D(0, 0),
      direction: null,
      repeatTimer: null,
      lastMoveTime: Date.now(),
    };
  }

  private createInitialStickStateSet(): GamepadStickStateSet {
    return {
      left: this.createInitialStickState(),
      right: this.createInitialStickState(),
    };
  }

  private getStickState(
    gamepadIndex: number,
    side: GamepadStickSide
  ): GamepadStickState {
    let stickStateSet = this.stickStatesByGamepad.get(gamepadIndex);

    if (!stickStateSet) {
      stickStateSet = this.createInitialStickStateSet();
      this.stickStatesByGamepad.set(gamepadIndex, stickStateSet);
    }

    return stickStateSet[side];
  }

  private readonly handleNewGamepadConnection = (event: GamepadEvent) => {
    const gamepad = event.gamepad;

    this.gamepads.set(gamepad.index, gamepad);

    if (!this.isPolling) {
      this.startPolling();
    }

    this.notifyStateChange();
  };

  private readonly handleGamepadDisconnection = (event: GamepadEvent) => {
    const gamepad = event.gamepad;

    this.gamepads.delete(gamepad.index);
    this.gamepadStates.delete(gamepad.index);

    if (this.activeGamepadIndex === gamepad.index) {
      this.activeGamepadIndex = null;
    }

    this.clearTimersForGamepad(gamepad.index);
    this.stickStatesByGamepad.delete(gamepad.index);
    this.recentAcceptedInputs = this.recentAcceptedInputs.filter(
      (input) => input.gamepadIndex !== gamepad.index
    );

    if (this.gamepads.size === 0) {
      this.stopPolling();
    }

    this.notifyStateChange();
  };

  private pollGamepads() {
    const gamepads = globalThis.navigator.getGamepads();

    for (const gamepad of gamepads) {
      if (!gamepad) continue;

      this.gamepads.set(gamepad.index, gamepad);
      this.updateGamepadState(gamepad.index, gamepad);
    }

    this.animationFrameId = globalThis.requestAnimationFrame(() =>
      this.pollGamepads()
    );
  }

  private startPolling() {
    if (this.isPolling) return;

    this.isPolling = true;
    this.pollGamepads();
  }

  private stopPolling() {
    if (!this.isPolling) return;

    if (this.animationFrameId !== null) {
      globalThis.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.isPolling = false;
    this.clearAllTimers();
  }

  private updateButtonState(
    gamepadState: GamepadRawState,
    type: GamepadButtonType,
    buttonState: Pick<GamepadButton, "pressed" | "value">,
    index: number,
    now: number
  ) {
    const prevState = gamepadState.buttons.get(type);

    if (
      prevState?.pressed === buttonState.pressed &&
      prevState?.value === buttonState.value
    )
      return;

    gamepadState.buttons.set(type, {
      pressed: buttonState.pressed,
      value: buttonState.value,
      lastUpdated: now,
    });

    if (buttonState.pressed && !prevState?.pressed) {
      const inputMeta = this.resolveGamepadInput(index, {
        allowSwitch: true,
        input: {
          kind: "button",
          button: type,
        },
        now,
      });

      this.triggerButtonPressCallbacks(index, type, inputMeta);

      if (inputMeta.accepted) {
        this.setupDpadRepeat(index, type);
      }
    }

    if (!buttonState.pressed && prevState?.pressed) {
      this.clearDpadRepeatTimer(index, type);
    }
  }

  private isDpadButton(type: GamepadButtonType): boolean {
    return (
      type === GamepadButtonType.DPAD_UP ||
      type === GamepadButtonType.DPAD_DOWN ||
      type === GamepadButtonType.DPAD_LEFT ||
      type === GamepadButtonType.DPAD_RIGHT
    );
  }

  private isDpadPressed(
    gamepadIndex: number,
    type: GamepadButtonType
  ): boolean {
    return (
      this.gamepadStates.get(gamepadIndex)?.buttons.get(type)?.pressed === true
    );
  }

  private getDpadRepeatTimers(gamepadIndex: number): DpadRepeatTimers {
    let timers = this.dpadRepeatTimersByGamepad.get(gamepadIndex);

    if (!timers) {
      timers = new Map();
      this.dpadRepeatTimersByGamepad.set(gamepadIndex, timers);
    }

    return timers;
  }

  private getAcceleratedRepeatInterval(repeatCount: number): number {
    if (repeatCount < this.repeatWarmupTicks) {
      return this.repeatWarmupInterval;
    }

    const accelerationTick = repeatCount - this.repeatWarmupTicks;
    const interval =
      this.repeatAcceleratedStartInterval -
      accelerationTick * this.repeatAccelerationStep;

    return Math.max(this.repeatMinInterval, interval);
  }

  private setupDpadRepeat(gamepadIndex: number, type: GamepadButtonType): void {
    if (!this.isDpadButton(type)) return;

    this.clearDpadRepeatTimer(gamepadIndex, type);

    const timers = this.getDpadRepeatTimers(gamepadIndex);
    const timer = globalThis.window.setTimeout(() => {
      if (!this.isDpadPressed(gamepadIndex, type)) {
        this.clearDpadRepeatTimer(gamepadIndex, type);
        return;
      }

      const inputMeta = this.resolveGamepadInput(gamepadIndex, {
        allowSwitch: false,
        input: {
          kind: "button",
          button: type,
        },
        now: Date.now(),
      });

      this.triggerButtonPressCallbacks(gamepadIndex, type, inputMeta);

      if (inputMeta.accepted) {
        this.repeatDpadCallback(gamepadIndex, type);
      } else {
        this.clearDpadRepeatTimer(gamepadIndex, type);
      }
    }, this.sticksInitialRepeatDelay);

    timers.set(type, timer);
  }

  private repeatDpadCallback(
    gamepadIndex: number,
    type: GamepadButtonType
  ): void {
    const timers = this.getDpadRepeatTimers(gamepadIndex);
    let repeatCount = 0;

    const scheduleRepeat = (callback: () => void) => {
      const timer = globalThis.window.setTimeout(
        callback,
        this.getAcceleratedRepeatInterval(repeatCount)
      );

      repeatCount += 1;
      timers.set(type, timer);
    };

    const repeat = () => {
      if (!this.isDpadPressed(gamepadIndex, type)) {
        this.clearDpadRepeatTimer(gamepadIndex, type);
        return;
      }

      const inputMeta = this.resolveGamepadInput(gamepadIndex, {
        allowSwitch: false,
        input: {
          kind: "button",
          button: type,
        },
        now: Date.now(),
      });

      this.triggerButtonPressCallbacks(gamepadIndex, type, inputMeta);

      if (!inputMeta.accepted) {
        this.clearDpadRepeatTimer(gamepadIndex, type);
        return;
      }

      scheduleRepeat(repeat);
    };

    scheduleRepeat(repeat);
  }

  private normalizeAxisValue(value: number, min: number, max: number): number {
    if (max === min) return 0;

    const normalized = (value - min) / (max - min);
    return Math.max(0, Math.min(1, normalized));
  }

  private getAxisButtonState(
    gamepad: Gamepad,
    mapping: GamepadAxisButtonMapping
  ): Pick<GamepadButton, "pressed" | "value"> | null {
    const axisState = gamepad.axes[mapping.axis];

    if (axisState === undefined) return null;

    const threshold = mapping.threshold ?? this.axisButtonThreshold;
    const directionalValue =
      mapping.direction === "negative" ? -axisState : axisState;
    const value = Math.max(0, Math.min(1, directionalValue));

    return {
      pressed: directionalValue >= threshold,
      value,
    };
  }

  private getAxisTriggerState(
    gamepad: Gamepad,
    mapping: GamepadAxisTriggerMapping
  ): Pick<GamepadButton, "pressed" | "value"> | null {
    const axisState = gamepad.axes[mapping.axis];

    if (axisState === undefined) return null;

    const min = mapping.min ?? -1;
    const max = mapping.max ?? 1;
    const threshold = mapping.threshold ?? this.axisTriggerThreshold;
    const value = this.normalizeAxisValue(axisState, min, max);

    return {
      pressed: value >= threshold,
      value,
    };
  }

  private getPhysicalAxisValue(
    gamepad: Gamepad,
    mapping: GamepadPhysicalAxisMapping
  ): number | null {
    let axisState = gamepad.axes[mapping.index];

    if (axisState === undefined) return null;

    if (mapping.invert) {
      axisState = -axisState;
    }

    if (Math.abs(axisState) < this.sticksDeadzone) {
      axisState = 0;
    }

    return axisState;
  }

  private triggerButtonPressCallbacks(
    gamepadIndex: number,
    type: GamepadButtonType,
    meta: GamepadInputEventMeta
  ): void {
    const callbacks = this.buttonPressCallbacks.get(type);
    if (!callbacks) return;

    callbacks.forEach((callback) => {
      try {
        callback({
          gamepadIndex,
          button: type,
          ...meta,
        });
      } catch (error) {
        console.error(`Error in button press callback for ${type}:`, error);
      }
    });
  }

  public onButtonPress(
    type: GamepadButtonType,
    callback: ButtonPressCallback
  ): () => void {
    if (!this.buttonPressCallbacks.has(type)) {
      this.buttonPressCallbacks.set(type, new Set());
    }

    const callbacks = this.buttonPressCallbacks.get(type) ?? new Set();
    this.buttonPressCallbacks.set(type, callbacks);
    callbacks.add(callback);

    return () => {
      const callbackSet = this.buttonPressCallbacks.get(type);
      if (!callbackSet) return;

      callbackSet.delete(callback);
      if (callbackSet.size === 0) {
        this.buttonPressCallbacks.delete(type);
      }
    };
  }

  private notifyStateChange(): void {
    this.stateChangeCallbacks.forEach((callback) => {
      try {
        callback();
      } catch (error) {
        console.error("Error in state change callback:", error);
      }
    });
  }

  private updateMappedButtonState(
    gamepadState: GamepadRawState,
    type: GamepadButtonType,
    buttonState: Pick<GamepadButton, "pressed" | "value">,
    gamepadIndex: number,
    now: number
  ): boolean {
    const prevState = gamepadState.buttons.get(type);

    if (
      prevState?.pressed === buttonState.pressed &&
      prevState?.value === buttonState.value
    ) {
      return false;
    }

    this.updateButtonState(gamepadState, type, buttonState, gamepadIndex, now);
    return true;
  }

  private updateMappedAxisState(
    gamepadState: GamepadRawState,
    type: GamepadAxisType,
    axisState: number,
    now: number
  ): boolean {
    const prevState = gamepadState.axes.get(type);

    if (prevState && Math.abs(prevState.value - axisState) <= 0.01) {
      return false;
    }

    gamepadState.axes.set(type, {
      value: axisState,
      lastUpdated: now,
    });

    return true;
  }

  private setStickPositionAxis(
    stickPositions: StickPositions,
    type: GamepadAxisType,
    axisState: number
  ): void {
    switch (type) {
      case GamepadAxisType.LEFT_STICK_X:
        stickPositions.left.x = axisState;
        break;
      case GamepadAxisType.LEFT_STICK_Y:
        stickPositions.left.y = axisState;
        break;
      case GamepadAxisType.RIGHT_STICK_X:
        stickPositions.right.x = axisState;
        break;
      case GamepadAxisType.RIGHT_STICK_Y:
        stickPositions.right.y = axisState;
        break;
    }
  }

  private applyGamepadMapping(
    gamepadState: GamepadRawState,
    mapping: GamepadInputMapping,
    gamepad: Gamepad,
    gamepadIndex: number,
    now: number,
    stickPositions: StickPositions
  ): boolean {
    switch (mapping.source) {
      case "button": {
        const buttonState = gamepad.buttons[mapping.index];
        if (!buttonState) return false;

        return this.updateMappedButtonState(
          gamepadState,
          mapping.type,
          buttonState,
          gamepadIndex,
          now
        );
      }
      case "axis-button": {
        const buttonState = this.getAxisButtonState(gamepad, mapping);
        if (!buttonState) return false;

        return this.updateMappedButtonState(
          gamepadState,
          mapping.type,
          buttonState,
          gamepadIndex,
          now
        );
      }
      case "axis-trigger": {
        const buttonState = this.getAxisTriggerState(gamepad, mapping);
        if (!buttonState) return false;

        return this.updateMappedButtonState(
          gamepadState,
          mapping.type,
          buttonState,
          gamepadIndex,
          now
        );
      }
      case "axis": {
        const axisState = this.getPhysicalAxisValue(gamepad, mapping);
        if (axisState === null) return false;

        this.setStickPositionAxis(stickPositions, mapping.type, axisState);
        return this.updateMappedAxisState(
          gamepadState,
          mapping.type,
          axisState,
          now
        );
      }
    }
  }

  private updateGamepadState(index: number, gamepad: Gamepad) {
    const layout = this.getNewLayoutOrCached(gamepad);
    const now = Date.now();

    if (!this.gamepadStates.has(index)) {
      this.gamepadStates.set(index, {
        name: gamepad.id,
        layout: layout.name,
        buttons: new Map(),
        axes: new Map(),
      });

      this.notifyStateChange();
    }

    const gamepadState = this.gamepadStates.get(index);
    if (!gamepadState) return;

    const gamepadIndex = index;

    let hasStateChanged = false;

    const stickPositions: StickPositions = {
      left: { x: 0, y: 0 },
      right: { x: 0, y: 0 },
    };

    for (const mapping of layout.mappings) {
      hasStateChanged =
        this.applyGamepadMapping(
          gamepadState,
          mapping,
          gamepad,
          gamepadIndex,
          now,
          stickPositions
        ) || hasStateChanged;
    }

    this.updateStickState(
      gamepadIndex,
      "left",
      new Vector2D(stickPositions.left.x, stickPositions.left.y),
      now
    );
    this.updateStickState(
      gamepadIndex,
      "right",
      new Vector2D(stickPositions.right.x, stickPositions.right.y),
      now
    );

    if (hasStateChanged || this.hasPendingActiveGamepadChange) {
      this.hasPendingActiveGamepadChange = false;
      this.notifyStateChange();
    }
  }

  private updateStickState(
    gamepadIndex: number,
    side: GamepadStickSide,
    position: Vector2D,
    now: number
  ) {
    const stickState = this.getStickState(gamepadIndex, side);

    const prevDirection = stickState.direction;

    stickState.position = position;
    stickState.lastMoveTime = now;

    const magnitude = position.magnitude();

    const newDirection =
      magnitude > this.sticksDirectionThreshold
        ? position.dominantDirection()
        : null;

    if (newDirection === prevDirection) return;

    if (stickState.repeatTimer !== null) {
      globalThis.window.clearTimeout(stickState.repeatTimer);
      stickState.repeatTimer = null;
    }

    stickState.direction = newDirection;

    if (newDirection) {
      const inputMeta = this.resolveGamepadInput(gamepadIndex, {
        allowSwitch: true,
        input: {
          kind: "stick",
          side,
          direction: newDirection,
        },
        now,
      });

      this.triggerStickCallbacks(gamepadIndex, side, newDirection, inputMeta);

      if (inputMeta.accepted) {
        this.setupStickRepeat(gamepadIndex, side, newDirection);
      }
    }
  }

  private setupStickRepeat(
    gamepadIndex: number,
    side: GamepadStickSide,
    direction: GamepadAxisDirection
  ) {
    const stickState = this.getStickState(gamepadIndex, side);

    stickState.repeatTimer = globalThis.window.setTimeout(() => {
      if (stickState.direction === direction) {
        const inputMeta = this.resolveGamepadInput(gamepadIndex, {
          allowSwitch: false,
          input: {
            kind: "stick",
            side,
            direction,
          },
          now: Date.now(),
        });

        this.triggerStickCallbacks(gamepadIndex, side, direction, inputMeta);

        if (inputMeta.accepted) {
          this.repeatStickCallback(gamepadIndex, side, direction);
        } else {
          stickState.repeatTimer = null;
        }
      } else {
        stickState.repeatTimer = null;
      }
    }, this.sticksInitialRepeatDelay);
  }

  private repeatStickCallback(
    gamepadIndex: number,
    side: GamepadStickSide,
    direction: GamepadAxisDirection
  ) {
    const stickState = this.getStickState(gamepadIndex, side);
    let repeatCount = 0;

    const scheduleRepeat = (callback: () => void) => {
      stickState.repeatTimer = globalThis.window.setTimeout(
        callback,
        this.getAcceleratedRepeatInterval(repeatCount)
      );

      repeatCount += 1;
    };

    const repeat = () => {
      if (stickState.direction !== direction) {
        stickState.repeatTimer = null;
        return;
      }

      const inputMeta = this.resolveGamepadInput(gamepadIndex, {
        allowSwitch: false,
        input: {
          kind: "stick",
          side,
          direction,
        },
        now: Date.now(),
      });

      this.triggerStickCallbacks(gamepadIndex, side, direction, inputMeta);

      if (!inputMeta.accepted) {
        stickState.repeatTimer = null;
        return;
      }

      scheduleRepeat(repeat);
    };

    scheduleRepeat(repeat);
  }

  private clearStickTimer(stickState: GamepadStickState) {
    if (stickState.repeatTimer !== null) {
      globalThis.window.clearTimeout(stickState.repeatTimer);
      stickState.repeatTimer = null;
    }
  }

  private clearDpadRepeatTimer(
    gamepadIndex: number,
    type: GamepadButtonType
  ): void {
    const timers = this.dpadRepeatTimersByGamepad.get(gamepadIndex);

    if (!timers) return;

    const timer = timers.get(type);

    if (timer === undefined) return;

    globalThis.window.clearTimeout(timer);
    timers.delete(type);

    if (timers.size === 0) {
      this.dpadRepeatTimersByGamepad.delete(gamepadIndex);
    }
  }

  private clearDpadRepeatTimersForGamepad(gamepadIndex: number): void {
    const timers = this.dpadRepeatTimersByGamepad.get(gamepadIndex);

    if (!timers) return;

    timers.forEach((timer) => globalThis.window.clearTimeout(timer));
    this.dpadRepeatTimersByGamepad.delete(gamepadIndex);
  }

  private clearAllDpadRepeatTimers(): void {
    this.dpadRepeatTimersByGamepad.forEach((timers) => {
      timers.forEach((timer) => globalThis.window.clearTimeout(timer));
    });
    this.dpadRepeatTimersByGamepad.clear();
  }

  private clearAllTimers() {
    this.stickStatesByGamepad.forEach((stickStateSet) => {
      this.clearStickTimer(stickStateSet.left);
      this.clearStickTimer(stickStateSet.right);
    });
    this.stickStatesByGamepad.clear();
    this.clearAllDpadRepeatTimers();
  }

  private clearTimersForGamepad(gamepadIndex: number) {
    const stickStateSet = this.stickStatesByGamepad.get(gamepadIndex);

    if (stickStateSet) {
      this.clearStickTimer(stickStateSet.left);
      this.clearStickTimer(stickStateSet.right);
    }

    this.clearDpadRepeatTimersForGamepad(gamepadIndex);
  }

  private triggerStickCallbacks(
    gamepadIndex: number,
    side: GamepadStickSide,
    direction: GamepadAxisDirection,
    meta: GamepadInputEventMeta
  ) {
    const sideCallbacks = this.stickMoveCallbacks.get(side);
    if (!sideCallbacks) return;

    const callbacks = sideCallbacks.get(direction);
    if (!callbacks) return;

    callbacks.forEach((callback) => {
      try {
        callback({
          gamepadIndex,
          side,
          direction,
          ...meta,
        });
      } catch (error) {
        console.error(
          `Error in stick move callback for ${side} ${direction}:`,
          error
        );
      }
    });
  }

  public getCurrentState(
    index?: number
  ): GamepadRawState | Map<number, GamepadRawState> | null {
    if (index !== undefined) {
      const state = this.gamepadStates.get(index);
      if (!state) return null;

      return {
        name: state.name,
        layout: state.layout,
        buttons: new Map(state.buttons),
        axes: new Map(state.axes),
      };
    }

    const states = new Map<number, GamepadRawState>();
    this.gamepadStates.forEach((state, idx) => {
      states.set(idx, {
        name: state.name,
        layout: state.layout,
        buttons: new Map(state.buttons),
        axes: new Map(state.axes),
      });
    });

    return states;
  }

  public getActiveGamepadIndex(): number | null {
    return this.activeGamepadIndex;
  }

  public getLastActiveGamepad(): number | null {
    return this.getActiveGamepadIndex();
  }

  public setActiveGamepadIndex(index: number | null): void {
    if (this.activeGamepadIndex === index) return;

    this.activeGamepadIndex = index;
    this.lastActiveGamepadSwitchTime = Date.now();
    this.hasPendingActiveGamepadChange = false;
    this.notifyStateChange();
  }

  public onStateChange(callback: () => void): () => void {
    this.stateChangeCallbacks.add(callback);

    return () => {
      this.stateChangeCallbacks.delete(callback);
    };
  }

  public onStickMove(
    side: GamepadStickSide,
    direction: GamepadAxisDirection,
    callback: StickMoveCallback
  ): () => void {
    if (!this.stickMoveCallbacks.has(side)) {
      this.stickMoveCallbacks.set(side, new Map());
    }

    const sideCallbacks = this.stickMoveCallbacks.get(side) ?? new Map();
    this.stickMoveCallbacks.set(side, sideCallbacks);

    if (!sideCallbacks.has(direction)) {
      sideCallbacks.set(direction, new Set());
    }

    const callbacks = sideCallbacks.get(direction) ?? new Set();
    sideCallbacks.set(direction, callbacks);
    callbacks.add(callback);

    return () => {
      const sideMap = this.stickMoveCallbacks.get(side);
      if (sideMap) {
        const callbackSet = sideMap.get(direction);
        if (callbackSet) {
          callbackSet.delete(callback);
          if (callbackSet.size === 0) {
            sideMap.delete(direction);
            if (sideMap.size === 0) {
              this.stickMoveCallbacks.delete(side);
            }
          }
        }
      }
    };
  }

  public vibrate(
    duration: number,
    weakMagnitude: number,
    strongMagnitude: number,
    gamepadIndex: number
  ): void {
    const activeGamepad = this.gamepads.get(gamepadIndex);

    if (!activeGamepad?.vibrationActuator) return;

    try {
      activeGamepad.vibrationActuator.playEffect("dual-rumble", {
        startDelay: 0,
        duration: duration,
        weakMagnitude: Math.max(0, Math.min(1, weakMagnitude)),
        strongMagnitude: Math.max(0, Math.min(1, strongMagnitude)),
      });
    } catch (error) {
      console.error("Error ao tentar vibrar o controle:", error);
    }
  }

  public dispose(): void {
    this.stopPolling();
    globalThis.window.removeEventListener(
      "gamepadconnected",
      this.handleNewGamepadConnection
    );
    globalThis.window.removeEventListener(
      "gamepaddisconnected",
      this.handleGamepadDisconnection
    );
    this.gamepads.clear();
    this.gamepadStates.clear();
    this.buttonPressCallbacks.clear();
    this.stickMoveCallbacks.clear();
    this.stateChangeCallbacks.clear();
    this.activeGamepadIndex = null;
    this.lastActiveGamepadSwitchTime = 0;
    this.hasPendingActiveGamepadChange = false;
    this.recentAcceptedInputs = [];
    this.clearAllTimers();
  }

  private getNewLayoutOrCached(gamepad: Gamepad) {
    if (!this.layoutCache.has(gamepad.id)) {
      const layout = getGamepadLayout(gamepad);
      this.layoutCache.set(gamepad.id, layout);
      return layout;
    }

    return this.layoutCache.get(gamepad.id) ?? getGamepadLayout(gamepad);
  }

  private getGamepadHardwareKey(gamepadIndex: number): string | null {
    const id =
      this.gamepads.get(gamepadIndex)?.id ??
      this.gamepadStates.get(gamepadIndex)?.name;
    const match = /Vendor:\s*([0-9a-f]{4})\s+Product:\s*([0-9a-f]{4})/i.exec(
      id ?? ""
    );

    if (!match) return null;

    return `${match[1].toLowerCase()}:${match[2].toLowerCase()}`;
  }

  private getInputSignatureKey(input: GamepadInputDescriptor): string {
    if (input.kind === "button") {
      return `button:${input.button}`;
    }

    return `stick:${input.side}:${input.direction}`;
  }

  private getEchoSuppressionWindow(input: GamepadInputDescriptor): number {
    return input.kind === "button"
      ? this.buttonEchoSuppressionWindow
      : this.stickEchoSuppressionWindow;
  }

  private pruneRecentAcceptedInputs(now: number): void {
    const maxWindow = Math.max(
      this.buttonEchoSuppressionWindow,
      this.stickEchoSuppressionWindow
    );

    this.recentAcceptedInputs = this.recentAcceptedInputs.filter(
      (input) => now - input.acceptedAt <= maxWindow
    );
  }

  private recordAcceptedInput(
    gamepadIndex: number,
    input: GamepadInputDescriptor,
    now: number
  ): void {
    const hardwareKey = this.getGamepadHardwareKey(gamepadIndex);
    if (!hardwareKey) return;

    this.pruneRecentAcceptedInputs(now);
    this.recentAcceptedInputs.push({
      gamepadIndex,
      hardwareKey,
      signatureKey: this.getInputSignatureKey(input),
      acceptedAt: now,
    });
  }

  private findEchoInput(
    gamepadIndex: number,
    input: GamepadInputDescriptor,
    now: number
  ): { gamepadIndex: number; elapsedMs: number } | null {
    const hardwareKey = this.getGamepadHardwareKey(gamepadIndex);
    if (!hardwareKey) return null;

    this.pruneRecentAcceptedInputs(now);

    const signatureKey = this.getInputSignatureKey(input);
    const suppressionWindow = this.getEchoSuppressionWindow(input);

    for (let i = this.recentAcceptedInputs.length - 1; i >= 0; i -= 1) {
      const recentInput = this.recentAcceptedInputs[i];
      const elapsedMs = now - recentInput.acceptedAt;

      if (
        recentInput.gamepadIndex !== gamepadIndex &&
        recentInput.hardwareKey === hardwareKey &&
        recentInput.signatureKey === signatureKey &&
        elapsedMs <= suppressionWindow
      ) {
        return {
          gamepadIndex: recentInput.gamepadIndex,
          elapsedMs,
        };
      }
    }

    return null;
  }

  private resolveGamepadInput(
    gamepadIndex: number,
    options: {
      allowSwitch: boolean;
      input: GamepadInputDescriptor;
      now: number;
    }
  ): GamepadInputEventMeta {
    const previousActiveGamepadIndex = this.activeGamepadIndex;

    if (previousActiveGamepadIndex === gamepadIndex) {
      this.recordAcceptedInput(gamepadIndex, options.input, options.now);

      return {
        status: "accepted",
        accepted: true,
        activeGamepadIndex: this.activeGamepadIndex,
        previousActiveGamepadIndex,
      };
    }

    if (!options.allowSwitch) {
      return {
        status: "ignored-inactive",
        accepted: false,
        activeGamepadIndex: this.activeGamepadIndex,
        previousActiveGamepadIndex,
      };
    }

    const isWithinDuplicateWindow =
      previousActiveGamepadIndex !== null &&
      options.now - this.lastActiveGamepadSwitchTime <
        this.gamepadSwitchDuplicateWindow;

    if (isWithinDuplicateWindow) {
      return {
        status: "ignored-duplicate-window",
        accepted: false,
        activeGamepadIndex: this.activeGamepadIndex,
        previousActiveGamepadIndex,
      };
    }

    const echoInput =
      previousActiveGamepadIndex === null
        ? null
        : this.findEchoInput(gamepadIndex, options.input, options.now);

    if (echoInput) {
      return {
        status: "ignored-echo",
        accepted: false,
        activeGamepadIndex: this.activeGamepadIndex,
        previousActiveGamepadIndex,
        echoOfGamepadIndex: echoInput.gamepadIndex,
        echoSuppressionMs: echoInput.elapsedMs,
      };
    }

    this.activeGamepadIndex = gamepadIndex;
    this.lastActiveGamepadSwitchTime = options.now;
    this.hasPendingActiveGamepadChange = true;
    this.recordAcceptedInput(gamepadIndex, options.input, options.now);

    return {
      status: "accepted",
      accepted: true,
      activeGamepadIndex: this.activeGamepadIndex,
      previousActiveGamepadIndex,
    };
  }
}

class Vector2D {
  private readonly deadzone = 0.1;

  constructor(
    public x: number,
    public y: number
  ) {}

  magnitude(): number {
    return Math.hypot(this.x, this.y);
  }

  normalize(): Vector2D {
    const magnitude = this.magnitude();
    if (magnitude === 0) return new Vector2D(0, 0);

    return new Vector2D(this.x / magnitude, this.y / magnitude);
  }

  dominantDirection(): GamepadAxisDirection | null {
    const magnitude = this.magnitude();

    if (magnitude < this.deadzone) return null;

    const normalized = this.normalize();

    const projections = {
      [GamepadAxisDirection.UP]: -normalized.y,
      [GamepadAxisDirection.DOWN]: normalized.y,
      [GamepadAxisDirection.LEFT]: -normalized.x,
      [GamepadAxisDirection.RIGHT]: normalized.x,
    };

    return Object.entries(projections).reduce(
      (max, [direction, projection]) =>
        projection > max.projection
          ? { direction: direction as GamepadAxisDirection, projection }
          : max,
      { direction: null as GamepadAxisDirection | null, projection: -Infinity }
    ).direction;
  }
}
