/**
 * Core Runtime lifecycle state machine.
 *
 * Runtime owns its lifecycle state. Host receives a read-only view and decides
 * when to request orderly shutdown; it does not mutate Runtime state directly.
 *
 * This module intentionally does not manage bootstrap, configuration,
 * functional-system lifecycle, business resources, or process policy.
 */

export type RuntimeLifecycleState =
  | "Created"
  | "Initializing"
  | "Ready"
  | "Running"
  | "Stopping"
  | "Stopped"
  | "Failed"

export type RuntimeLifecycleSnapshot =
  | Readonly<{ state: "Created"; revision: number }>
  | Readonly<{ state: "Initializing"; revision: number }>
  | Readonly<{ state: "Ready"; revision: number }>
  | Readonly<{ state: "Running"; revision: number }>
  | Readonly<{ state: "Stopping"; revision: number }>
  | Readonly<{ state: "Stopped"; revision: number }>
  | Readonly<{ state: "Failed"; revision: number; cause: unknown }>

export class RuntimeLifecycleTransitionError extends Error {
  readonly currentState: RuntimeLifecycleState
  readonly targetState: RuntimeLifecycleState

  constructor(currentState: RuntimeLifecycleState, targetState: RuntimeLifecycleState) {
    super(`Invalid Runtime lifecycle transition: ${currentState} → ${targetState}`)
    this.name = "RuntimeLifecycleTransitionError"
    this.currentState = currentState
    this.targetState = targetState
  }
}

/**
 * The Host-facing surface. It can inspect lifecycle state but cannot transition it.
 */
export interface RuntimeLifecycleView {
  snapshot(): RuntimeLifecycleSnapshot
}

/**
 * The Runtime-facing surface. Only the Runtime implementation should retain this.
 */
export interface RuntimeLifecycleController extends RuntimeLifecycleView {
  beginInitialization(): void
  markReady(): void
  beginRunning(): void
  beginStopping(): void
  markStopped(): void
  fail(cause: unknown): void
}

const terminal = (state: RuntimeLifecycleState) => state === "Stopped" || state === "Failed"

export function createRuntimeLifecycle(): {
  readonly controller: RuntimeLifecycleController
  readonly view: RuntimeLifecycleView
} {
  let current: RuntimeLifecycleSnapshot = Object.freeze({ state: "Created", revision: 0 })

  const snapshot = () => current

  const transition = (target: RuntimeLifecycleState) => {
    const from = current.state
    const allowed =
      (from === "Created" && target === "Initializing") ||
      (from === "Initializing" && target === "Ready") ||
      (from === "Ready" && (target === "Running" || target === "Stopping")) ||
      (from === "Running" && target === "Stopping") ||
      (from === "Stopping" && target === "Stopped")

    if (!allowed) throw new RuntimeLifecycleTransitionError(from, target)

    current = Object.freeze({ state: target, revision: current.revision + 1 }) as RuntimeLifecycleSnapshot
  }

  const view: RuntimeLifecycleView = Object.freeze({ snapshot })

  const controller: RuntimeLifecycleController = Object.freeze({
    snapshot,
    beginInitialization: () => transition("Initializing"),
    markReady: () => transition("Ready"),
    beginRunning: () => transition("Running"),
    beginStopping: () => transition("Stopping"),
    markStopped: () => transition("Stopped"),
    fail(cause: unknown) {
      if (terminal(current.state)) {
        throw new RuntimeLifecycleTransitionError(current.state, "Failed")
      }
      current = Object.freeze({
        state: "Failed",
        revision: current.revision + 1,
        cause,
      })
    },
  })

  return Object.freeze({ controller, view })
}
