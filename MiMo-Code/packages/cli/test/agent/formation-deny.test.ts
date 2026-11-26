import { afterEach, beforeEach, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Permission } from "../../src/permission"
import { provideInstance, tmpdir } from "../fixture/fixture"

// Needs the workspace dependencies; native verification: MiMo. Pins the Route-P decision (GPT final gate): the tool-layer
// defence is an `external_directory` hardPermission deny on an ABSOLUTE glob, on EVERY agent, only when the flag is on.

const KEY = "MIMOCODE_EXPERIMENTAL_MEMORY_FORMATION"
let prev: string | undefined
beforeEach(() => {
  prev = process.env[KEY]
})
afterEach(async () => {
  if (prev === undefined) delete process.env[KEY]
  else process.env[KEY] = prev
  await Instance.disposeAll()
})

const list = (dir: string) =>
  Effect.runPromise(provideInstance(dir)(Agent.Service.use((svc) => svc.list())).pipe(Effect.provide(Agent.defaultLayer)))

const target = () => path.join(Global.Path.data, "formation", "projects", "p1", "cand_x.json")
const allowAll = [{ permission: "external_directory", pattern: "*", action: "allow" as const }]

test("flag ON: every agent (native and config-defined) denies <data>/formation even against a user/session external_directory allow", async () => {
  process.env[KEY] = "1"
  await using tmp = await tmpdir({ config: { permission: { external_directory: { "*": "allow" } }, agent: { custom_writer: { mode: "all" } } } as never })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await list(tmp.path)
      expect(agents.length).toBeGreaterThan(5)
      expect(agents.some((a) => a.name === "custom_writer")).toBe(true)
      for (const a of agents) {
        const rt = Agent.runtimePermission(a, allowAll)
        expect(Permission.evaluate("external_directory", target(), rt).action).toBe("deny")
        expect(Permission.evaluate("external_directory", path.join(Global.Path.data, "formation", "*"), rt).action).toBe("deny")
        // scope is exact: other external paths keep their prior outcome
        expect(Permission.evaluate("external_directory", path.join(Global.Path.data, "x", "y.txt"), rt).action).not.toBe("deny")
        expect(Permission.evaluate("external_directory", path.join(Global.Path.data, "formation2", "y.txt"), rt).action).not.toBe("deny")
      }
    },
  })
})

test("flag OFF: no agent carries the formation rule (rulesets unchanged)", async () => {
  delete process.env[KEY]
  await using tmp = await tmpdir({ config: { permission: { external_directory: { "*": "allow" } } } as never })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      for (const a of await list(tmp.path)) {
        const rt = Agent.runtimePermission(a, allowAll)
        expect(JSON.stringify(a.hardPermission ?? [])).not.toContain("formation")
        expect(Permission.evaluate("external_directory", target(), rt).action).not.toBe("deny")
      }
    },
  })
})
