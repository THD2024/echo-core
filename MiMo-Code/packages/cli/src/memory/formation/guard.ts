/**
 * Memory Formation Phase 1 — tool-layer defence config (pure data).
 *
 * The rule goes on `external_directory` with an ABSOLUTE glob: that is the permission the file-mutating tools actually
 * hit for a path outside the worktree (MiMo native Z1/Z2/Z3: an `edit` rule with an absolute glob is dead because the edit
 * tools submit worktree-relative patterns). It is applied through `agent.hardPermission`, which `runtimePermission`
 * re-appends AFTER user/session rules, so a user `external_directory: {"*": "allow"}` cannot override it.
 *
 * This is a CONVENIENCE layer, not isolation: bash/shell is not covered. Do not describe it as isolation anywhere.
 */
import * as path from "node:path"

export function formationDenyConfig(dataDir: string): { external_directory: Record<string, "deny"> } {
  return {
    external_directory: {
      [path.join(dataDir, "formation")]: "deny",
      [path.join(dataDir, "formation", "*")]: "deny",
    },
  }
}
