import { expect, test } from "bun:test"
import {
  createRuntimeLifecycle,
  RuntimeLifecycleTransitionError,
  type RuntimeLifecycleState,
} from "../../src/echo-runtime/lifecycle"

test("starts in Created and exposes a read-only Host view", () => {
  const { controller, view } = createRuntimeLifecycle()

  expect(view.snapshot()).toEqual({ state: "Created", revision: 0 })
  expect(controller.snapshot()).toBe(view.snapshot())
  expect("beginInitialization" in view).toBe(false)
  expect(Object.isFrozen(view.snapshot())).toBe(true)
})

test("follows the normal lifecycle in order and records each transition", () => {
  const { controller, view } = createRuntimeLifecycle()
  const states: RuntimeLifecycleState[] = []

  states.push(view.snapshot().state)
  controller.beginInitialization()
  states.push(view.snapshot().state)
  controller.markReady()
  states.push(view.snapshot().state)
  controller.beginRunning()
  states.push(view.snapshot().state)
  controller.beginStopping()
  states.push(view.snapshot().state)
  controller.markStopped()
  states.push(view.snapshot().state)

  expect(states).toEqual(["Created", "Initializing", "Ready", "Running", "Stopping", "Stopped"])
  expect(view.snapshot().revision).toBe(5)
})

test("Ready is a distinct stable state and may orderly-stop without entering Running", () => {
  const { controller, view } = createRuntimeLifecycle()

  controller.beginInitialization()
  controller.markReady()

  expect(view.snapshot().state).toBe("Ready")

  controller.beginStopping()
  controller.markStopped()

  expect(view.snapshot().state).toBe("Stopped")
})

test("rejects skipped, repeated, and out-of-order transitions", () => {
  const { controller, view } = createRuntimeLifecycle()

  expect(() => controller.markReady()).toThrow(RuntimeLifecycleTransitionError)
  expect(() => controller.beginRunning()).toThrow(RuntimeLifecycleTransitionError)
  expect(view.snapshot().state).toBe("Created")

  controller.beginInitialization()
  expect(() => controller.beginInitialization()).toThrow(RuntimeLifecycleTransitionError)
  expect(() => controller.beginStopping()).toThrow(RuntimeLifecycleTransitionError)
  expect(view.snapshot().state).toBe("Initializing")
})

test("Failed is terminal and retains the original failure cause", () => {
  const { controller, view } = createRuntimeLifecycle()
  const original = new Error("bootstrap failed")

  controller.beginInitialization()
  controller.fail(original)

  expect(view.snapshot()).toEqual({ state: "Failed", revision: 2, cause: original })
  expect(() => controller.markReady()).toThrow(RuntimeLifecycleTransitionError)
  expect(() => controller.fail(new Error("cleanup failed"))).toThrow(RuntimeLifecycleTransitionError)
  expect(view.snapshot()).toEqual({ state: "Failed", revision: 2, cause: original })
})

test("an unrecoverable failure during orderly shutdown becomes Failed", () => {
  const { controller, view } = createRuntimeLifecycle()
  const failure = new Error("shutdown failed")

  controller.beginInitialization()
  controller.markReady()
  controller.beginRunning()
  controller.beginStopping()
  controller.fail(failure)

  expect(view.snapshot()).toEqual({ state: "Failed", revision: 5, cause: failure })
})

test("Stopped is terminal and cannot be restarted or failed", () => {
  const { controller, view } = createRuntimeLifecycle()

  controller.beginInitialization()
  controller.markReady()
  controller.beginRunning()
  controller.beginStopping()
  controller.markStopped()

  expect(() => controller.beginInitialization()).toThrow(RuntimeLifecycleTransitionError)
  expect(() => controller.fail(new Error("late failure"))).toThrow(RuntimeLifecycleTransitionError)
  expect(view.snapshot()).toEqual({ state: "Stopped", revision: 5 })
})
