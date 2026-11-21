import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Command } from "../../src/command"
import type { Config } from "../../src/config"
import { MCP } from "../../src/mcp"
import { shouldObserveManualDream } from "../../src/session/manual-dream-audit"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(CrossSpawnSpawner.defaultLayer)

type McpPrompts = ReturnType<MCP.Interface["prompts"]>

/** The real Command service (real Config + Skill layers) over an MCP stub that only serves `prompts`. */
const commandLayer = (prompts: Record<string, { name: string; description?: string; client: string }>) =>
  Command.appLayer.pipe(
    Layer.provide(
      Layer.succeed(
        MCP.Service,
        MCP.Service.of({
          status: () => Effect.succeed({}),
          clients: () => Effect.succeed({}),
          tools: () => Effect.succeed({}),
          prompts: () => Effect.succeed(prompts) as McpPrompts,
          resources: () => Effect.succeed({}),
          add: () => Effect.succeed({ status: { status: "disabled" as const } }),
          connect: () => Effect.void,
          disconnect: () => Effect.void,
          getPrompt: () => Effect.succeed(undefined),
          readResource: () => Effect.succeed(undefined),
          startAuth: () => Effect.die("unexpected MCP auth in builtin-command tests"),
          authenticate: () => Effect.die("unexpected MCP auth in builtin-command tests"),
          finishAuth: () => Effect.die("unexpected MCP auth in builtin-command tests"),
          removeAuth: () => Effect.void,
          supportsOAuth: () => Effect.succeed(false),
          hasStoredTokens: () => Effect.succeed(false),
          getAuthStatus: () => Effect.succeed("not_authenticated" as const),
        }),
      ),
    ),
  )

/** Resolve `/dream` through the real service, exactly as `SessionPrompt.command` does (`commands.get`). */
const dreamUnder = (options: { prompts?: Record<string, { name: string; description?: string; client: string }>; config?: Partial<Config.Info> } = {}) =>
  provideTmpdirInstance(
    () =>
      Effect.gen(function* () {
        const svc = yield* Command.Service
        return yield* svc.get(Command.Default.DREAM)
      }).pipe(Effect.provide(commandLayer(options.prompts ?? {}))),
    options.config ? { config: options.config } : undefined,
  )

/** The manual-audit predicate fed the way prompt.ts feeds it. */
const observed = (cmd: Command.Info | undefined) =>
  cmd !== undefined &&
  shouldObserveManualDream({
    isDreamCommand: Command.isBuiltinCommand(cmd),
    source: cmd.source,
    agentName: cmd.agent ?? "build",
    isSubtask: cmd.subtask === true,
  })

describe("built-in command identity (isBuiltinCommand)", () => {
  it.live("the native /dream is the built-in object and is observed", () =>
    Effect.gen(function* () {
      const cmd = yield* dreamUnder()
      expect(cmd).toBeDefined()
      expect(cmd!.source).toBe("command")
      expect(cmd!.agent).toBe("dream")
      expect(cmd!.subtask).toBe(false)
      expect(Command.isBuiltinCommand(cmd)).toBe(true)
      expect(observed(cmd)).toBe(true)
    }),
  )

  it.live("a config command.dream override is excluded even when it keeps agent=dream, source=command, subtask=false", () =>
    Effect.gen(function* () {
      const cmd = yield* dreamUnder({
        config: { command: { dream: { template: "My own consolidation: $ARGUMENTS", agent: "dream", subtask: false } } },
      })
      // The leak this closes: every field the old four-condition predicate looked at is identical to the built-in's.
      expect(cmd!.source).toBe("command")
      expect(cmd!.agent).toBe("dream")
      expect(cmd!.subtask).toBe(false)
      expect(plainTemplate(cmd!.template)).toContain("My own consolidation")
      expect(Command.isBuiltinCommand(cmd)).toBe(false)
      expect(observed(cmd)).toBe(false)
    }),
  )

  it.live("a config override that copies the built-in's description and hints is still excluded", () =>
    Effect.gen(function* () {
      const native = yield* dreamUnder()
      const cmd = yield* dreamUnder({
        config: {
          command: {
            dream: { template: "x", agent: "dream", subtask: false, description: native!.description },
          },
        },
      })
      expect(cmd!.description).toBe(native!.description)
      expect(Command.isBuiltinCommand(cmd)).toBe(false)
    }),
  )

  it.live("an MCP prompt registered under the same name replaces the built-in and is excluded", () =>
    Effect.gen(function* () {
      const cmd = yield* dreamUnder({ prompts: { dream: { name: "dream", description: "mcp dream", client: "srv" } } })
      expect(cmd!.source).toBe("mcp")
      expect(Command.isBuiltinCommand(cmd)).toBe(false)
      expect(observed(cmd)).toBe(false)
    }),
  )

  it.live("a hand-built object is never builtin, even a field-for-field copy of the real /dream", () =>
    Effect.gen(function* () {
      const native = yield* dreamUnder()
      const copy: Command.Info = { ...native!, template: native!.template }
      const literal: Command.Info = {
        name: "dream",
        description: native!.description,
        agent: "dream",
        source: "command",
        subtask: false,
        template: "t",
        hints: ["$ARGUMENTS"],
      }
      expect(Command.isBuiltinCommand(native)).toBe(true)
      expect(Command.isBuiltinCommand(copy)).toBe(false)
      expect(Command.isBuiltinCommand(literal)).toBe(false)
      expect(Command.isBuiltinCommand(undefined)).toBe(false)
      expect(observed(copy)).toBe(false)
      expect(observed(literal)).toBe(false)
    }),
  )
})

/** `template` is `string | Promise<string>`; the built-in and config templates are plain strings. */
function plainTemplate(template: Command.Info["template"]): string {
  if (typeof template !== "string") throw new Error("expected a string template")
  return template
}
