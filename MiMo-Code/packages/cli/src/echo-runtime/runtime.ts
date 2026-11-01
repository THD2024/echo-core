import {
  createRuntimeLifecycle,
  type RuntimeLifecycleView,
} from "./lifecycle"

/**
 * Operations owned by the Core Runtime implementation.
 *
 * These hooks must only initialize and release Runtime-owned foundations.
 * They must not take ownership of functional-system initialization or resources.
 * shutdown() must also tolerate partial initialization because it is called
 * after initialize() fails.
 */
export interface CoreRuntimeLifecycleHooks {
  initialize(): void | Promise<void>
  shutdown(): void | Promise<void>
}

/**
 * Host-facing Runtime instance API.
 *
 * Host can observe lifecycle state, initialize the instance, signal that the
 * Runtime has entered its operating phase, and request orderly shutdown.
 * It never receives the lifecycle controller.
 */
export interface CoreRuntime {
  readonly lifecycle: RuntimeLifecycleView
  initialize(): Promise<void>
  enterRunning(): void
  requestShutdown(): Promise<void>
}

/**
 * Creates one Core Runtime instance with one irreversible lifecycle.
 *
 * Initialization failure triggers the Runtime-owned shutdown hook so partially
 * initialized foundations can be released. The original initialization cause
 * remains the lifecycle failure cause even if cleanup also fails.
 */
export function createCoreRuntime(hooks: CoreRuntimeLifecycleHooks): CoreRuntime {
  const { controller, view } = createRuntimeLifecycle()
  let initialization: Promise<void> | undefined
  let shutdown: Promise<void> | undefined

  const initialize = (): Promise<void> => {
    if (initialization) return initialization

    controller.beginInitialization()
    initialization = Promise.resolve()
      .then(() => hooks.initialize())
      .then(() => {
        controller.markReady()
      })
      .catch(async (cause: unknown) => {
        let cleanupFailed = false
        let cleanupCause: unknown

        try {
          await hooks.shutdown()
        } catch (error) {
          cleanupFailed = true
          cleanupCause = error
        }

        controller.fail(cause)

        if (cleanupFailed) {
          throw new AggregateError(
            [cause, cleanupCause],
            "Core Runtime initialization failed and cleanup also failed",
            { cause },
          )
        }

        throw cause
      })

    return initialization
  }

  const enterRunning = () => {
    controller.beginRunning()
  }

  const requestShutdown = async (): Promise<void> => {
    if (shutdown) return shutdown

    // A Host shutdown request received during initialization is queued behind
    // initialization. The Runtime reaches Ready before orderly shutdown starts.
    if (view.snapshot().state === "Initializing") {
      if (!initialization) {
        throw new Error("Core Runtime is initializing without an initialization operation")
      }
      await initialization
      return requestShutdown()
    }

    controller.beginStopping()
    shutdown = Promise.resolve()
      .then(() => hooks.shutdown())
      .then(
        () => controller.markStopped(),
        (cause: unknown) => {
          controller.fail(cause)
          throw cause
        },
      )

    return shutdown
  }

  return Object.freeze({
    lifecycle: view,
    initialize,
    enterRunning,
    requestShutdown,
  })
}
