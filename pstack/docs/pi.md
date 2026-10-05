# Use this fork with Pi

This fork exposes pstack as a local Pi skill package. The package manifest is `../package.json` relative to this document, at the `pstack/` component root; personal and trusted project Pi settings select which skills load. Packaging does not implement Cursor's runtime or port every workflow. See [Fork maintenance](./fork-maintenance.md) for the agent-owned upstream update procedure and staging helper.

## Shared editing locations

On this machine, `/home/jack/git/cursor-plugins` is the fork checkout on `pi`. `/home/jack/git/pstack` links to its `pstack` directory. Edit skills through either path and commit from the repository root.

Matt's shared collection is `/home/jack/git/mattpocock-skills`, also on its own `pi` branch. Its selected directories are registered separately in `~/.pi/agent/settings.json`.

## Choose a workflow

Use `/skill:ask-pstack <your situation>` for a recommendation from this collection. It reads candidate skills, checks availability and dependencies, and recommends rather than executing by default. `/skill:ask-matt` serves the same purpose for Matt's collection.

The reusable router pattern is: identify the outcome, choose a narrow route, inspect its source, check installed availability and runtime prerequisites, then recommend the next invocation. Each collection owns its map rather than duplicating another collection's workflows.

## Invocation is opt-in

All pstack skills in this fork are user-invoked by default. The shared Matt fork follows the same policy. They remain discoverable through explicit `/skill:<name>` commands but are excluded from Pi's automatically advertised skill context.

To promote one skill, explicitly select it in personal/project Pi configuration and add its collection/name to the personal model-invocation allowlist in `~/.pi/agent/skill-adoption.json`, then deliberately change its `SKILL.md` frontmatter to `disable-model-invocation: false`. Run the adoption checks before activating the prepared source. Qualification remains a separate model/runtime/task evidence decision, not a consequence of promotion. For a Matt skill, also set `policy.allow_implicit_invocation: true` in its `agents/openai.yaml` to keep Codex metadata aligned. Review its description for a precise automatic trigger before promotion. Change the shared source for all consumers, or the project worktree for a project-specific promotion.

This flag controls discovery, not access to files. Explicitly started workflows can read supporting instructions within their authorized task. Mandatory startup safeguards remain independent of optional workflow selection; optional workflows require explicit user entry. Other installed skill collections are unchanged by this fork policy.

## Change the personal selection

Edit the matching entry in `~/.pi/agent/settings.json`. Skill filters use package-relative directory paths, not declared command names. The personal pstack selection uses deny-by-default filtering and 49 exact skill directory includes. It excludes `teach` and `tdd`. Those names are provided by Matt's collection instead. The pstack files remain available for project variants.

Matt's initial selection comes from locally available session evidence, including explicit user commands and skill-file loads. Loads can indicate inspection rather than execution. Evidence and loader validation are stored under `~/.pi/agent/audits/`.

The personal Pi package entries are the only installation mechanism for these collections. Legacy Matt symlinks under `~/.agents/skills` and `~/.claude/skills` were removed, along with the temporary discovery-ignore workaround. Add or remove selected skills in Pi settings rather than running the upstream linking script. Claude no longer receives Matt's skills through those removed links.

Restart Pi or run `/reload` after changing resources. After relocating the current session's working directory, restart from the canonical component root `/home/jack/git/cursor-plugins/pstack` instead of continuing from the old directory identity.

## Substitute project versions

A project variant is a sparse worktree of this fork on a project-named branch. Its worktree retains the repository's `pstack/` directory. Keep the nested worktree out of the consuming repository's Git tracking.

For a worktree at `<project>/.pi/packages/pstack`, the project package root is `./packages/pstack/pstack`, relative to the project's `.pi` directory. A project selection can keep shared `how` and replace `architect`:

```json
{
  "packages": [
    {
      "source": "/home/jack/git/pstack",
      "skills": ["skills/how/**"]
    },
    {
      "source": "./packages/pstack/pstack",
      "skills": ["skills/architect/**"]
    }
  ]
}
```

Merge this into existing project settings. The same-source shared entry replaces the personal selection for that project, so it must list every shared skill the project should retain. Select replacements from the project package without also enabling the shared same-named skills. Apply the same pattern independently to Matt's collection.

Prepare upstream updates outside the live checkout, compare against the last qualified configuration, check invocation flags, dependencies and the explicit selection lock, then deliberately activate reviewed changes. Do not merge upstream directly into the live checkout as an activation gate. Merge the validated `pi` branch into a project branch only when that project is ready. Editing a project worktree changes the project variant, not the shared checkout.

## Compatibility limits

The Pi manifest loads skills only. Cursor agents, Task calls, sticky mode metadata, model aliases, external plugins, and Cursor automations are not registered by it. Candidate workflows must use available Pi tools and authenticated models without weakening their verification requirements. Session approval rules take precedence over broader autonomy claims in imported skills.
