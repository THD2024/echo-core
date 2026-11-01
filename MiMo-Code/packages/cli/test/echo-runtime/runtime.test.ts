import { expect, test } from "bun:test"
import {
  createCoreRuntime,
} from "../../src/echo-runtime/runtime"
import { RuntimeLifecycleTransitionError } from "../../src/echo-runtime/lifecycle"

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

test("Host drives one Runtime instance through initialize, running, and shutdown APIs", async () => {
  const calls: string[] = []
  const runtime = createCoreRuntime({
    initialize: async () => { calls.push("initialize") },
    shutdown: async () => { calls.push("shutdown") },
  })

  expect(runtime.lifecycle.snapshot()).toEqual({ state: "Created", revision: 0 })
  expect("enterRunning" in runtime.lifecycle).toBe(false)
  expect("requestShutdown" in runtime.lifecycle).toBe(false)

  await runtime.initialize()
  expect(runtime.lifecycle.snapshot()).toEqual({ state: "Ready", revision: 2 })

  runtime.enterRunning()
  expect(runtime.lifecycle.snapshot()).toEqual({ state: "Running", revision: 3 })

  await runtime.requestShutdown()
  expect(runtime.lifecycle.snapshot()).toEqual({ state: "Stopped", revision: 5 })
  expect(calls).toEqual(["initialize", "shutdown"])
})

test("supports orderly shutdown from Ready without entering Running", async () => {
  const runtime = createCoreRuntime({
    initialize: () => {},
    shutdown: () => {},
  })

  await runtime.initialize()
  await runtime.requestShutdown()

  expect(runtime.lifecycle.snapshot().state).toBe("Stopped")
})

test("rejects entering Running before initialization completes", () => {
  const runtime = createCoreRuntime({
    initialize: () => {},
    shutdown: () => {},
  })

  expect(() => runtime.enterRunning()).toThrow(RuntimeLifecycleTransitionError)
  expect(runtime.lifecycle.snapshot().state).toBe("Created")
})

test("queues a Host shutdown request received during initialization", async () => {
  const gate = deferred<void>()
  const calls: string[] = []
  const runtime = createCoreRuntime({
    initialize: async () => {
      calls.push("initialize:start")
      await gate.promise
      calls.push("initialize:end")
    },
    shutdown: async () => { calls.push("shutdown") },
  })

  const initializing = runtime.initialize()
  await Promise.resolve()
  const stopping = runtime.requestShutdown()

  expect(runtime.lifecycle.snapshot().state).toBe("Initializing")
  gate.resolve()
  await Promise.all([initializing, stopping])

  expect(runtime.lifecycle.snapshot().state).toBe("Stopped")
  expect(calls).toEqual(["initialize:start", "initialize:end", "shutdown"])
})

test("initialization failure triggers cleanup and preserves the original cause", async () => {
  const original = new Error("runtime foundation failed")
  const calls: string[] = []
  const runtime = createCoreRuntime({
    initialize: async () => {
      calls.push("initialize")
      throw original
    },
    shutdown: async () => { calls.push("cleanup") },
  })

  await expect(runtime.initialize()).rejects.toBe(original)
  expect(runtime.lifecycle.snapshot()).toEqual({ state: "Failed", revision: 2, cause: original })
  expect(calls).toEqual(["initialize", "cleanup"])
})

test("cleanup failure does not replace the initialization failure cause", async () => {
  const original = new Error("runtime foundation failed")
  const cleanup = new Error("partial foundation cleanup failed")
  const runtime = createCoreRuntime({
    initialize: async () => { throw original },
    shutdown: async () => { throw cleanup },
  })

  const result = runtime.initialize()
  await expect(result).rejects.toBeInstanceOf(AggregateError)
  await result.catch((error: AggregateError) => {
    expect(error.cause).toBe(original)
    expect(error.errors).toEqual([original, cleanup])
  })
  expect(runtime.lifecycle.snapshot()).toEqual({ state: "Failed", revision: 2, cause: original })
})

test("shutdown failure transitions the Runtime to Failed", async () => {
  const failure = new Error("runtime shutdown failed")
  const runtime = createCoreRuntime({
    initialize: () => {},
    shutdown: async () => { throw failure },
  })

  await runtime.initialize()
  runtime.enterRunning()

  await expect(runtime.requestShutdown()).rejects.toBe(failure)
  expect(runtime.lifecycle.snapshot()).toEqual({ state: "Failed", revision: 4, cause: failure })
})

test("concurrent initialize and shutdown calls share one operation each", async () => {
  let initializeCalls = 0
  let shutdownCalls = 0
  const runtime = createCoreRuntime({
    initialize: async () => { initializeCalls++ },
    shutdown: async () => { shutdownCalls++ },
  })

  const firstInitialize = runtime.initialize()
  const secondInitialize = runtime.initialize()
  await Promise.all([firstInitialize, secondInitialize])

  const firstShutdown = runtime.requestShutdown()
  const secondShutdown = runtime.requestShutdown()
  await Promise.all([firstShutdown, secondShutdown])

  expect(initializeCalls).toBe(1)
  expect(shutdownCalls).toBe(1)
  expect(runtime.lifecycle.snapshot().state).toBe("Stopped")
})

test("rejects shutdown before initialization without changing lifecycle state", async () => {
  const runtime = createCoreRuntime({
    initialize: () => {},
    shutdown: () => {},
  })

  await expect(runtime.requestShutdown()).rejects.toBeInstanceOf(RuntimeLifecycleTransitionError)
  expect(runtime.lifecycle.snapshot()).toEqual({ state: "Created", revision: 0 })
})

test("a queued shutdown request preserves initialization failure and does not clean up twice", async () => {
  const gate = deferred<void>()
  const original = new Error("initialization failed")
  let cleanupCalls = 0
  const runtime = createCoreRuntime({
    initialize: async () => {
      await gate.promise
      throw original
    },
    shutdown: async () => { cleanupCalls++ },
  })

  const initializing = runtime.initialize()
  await Promise.resolve()
  const stopping = runtime.requestShutdown()
  gate.resolve()

  await expect(initializing).rejects.toBe(original)
  await expect(stopping).rejects.toBe(original)
  expect(cleanupCalls).toBe(1)
  expect(runtime.lifecycle.snapshot()).toEqual({ state: "Failed", revision: 2, cause: original })
})
