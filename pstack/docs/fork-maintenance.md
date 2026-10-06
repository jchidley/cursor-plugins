# Maintaining the pstack fork

## Owner interface

Ask the coding agent from the canonical component session root, `~/git/cursor-plugins/pstack`:

> Update this fork from upstream and keep my customizations.

The agent owns maintenance, not the owner memorizing a checklist: inspect retained staging work first, preserve local work, prepare or reuse a compatible stage, review the scope and customization delta, resolve conflicts where intent is clear, run the checks, and report the result and concrete blockers. Do not commit unrelated work just to satisfy the clean-repository gate. Ask only when intent is materially unclear or a separately controlled action needs approval.

This is direct repository maintenance, not entry into an optional skill. The owner's update request covers local integration into the intended `pi` branch after review and activation gates pass; do not ask for a second routine instruction or hand the procedure back as homework. The helper below prepares a stage, not an approval or automatic activation. Machine configuration changes, pushing, broader scope, and destructive worktree removal still need their applicable authorization. Report the final commit, checks, whether the live branch was updated, and any unmet prerequisites.

## Customization owners

| Difference | Owner |
| --- | --- |
| Explicit invocation and supporting-read boundaries | `AGENTS.md`, `docs/pi.md`, each flat `skills/*/SKILL.md` |
| Skills-only Pi exports and local commands | `package.json` |
| Selection-aware read-only routing and runtime prerequisites | `skills/ask-pstack/SKILL.md` |
| Supporting reads, dependencies, and qualification limits | `skill-adoption.json` |
| Personal/project selections, trust, promotion decisions and locks | Installed Pi configuration, outside this collection; never silently change it |

Preserve upstream history with merges, not squashing or replaying the adaptation. Include new upstream skills in the explicit-invocation policy. Do not blindly choose ours or theirs. Keep source presence, enabled selection, and model/runtime/task qualification distinct. See [Pi setup and compatibility limits](./pi.md).

## Local checks

Run from `pstack/`, not the enclosing Git repository root:

```bash
npm run check
npm test
```

The checker scans all flat skill directories, enforces unique names and exactly one `disable-model-invocation: true`, checks skills-only Pi exports, router safeguards, and schema-1 adoption owners and paths contained within pstack (including symlink containment). Dependencies must be skill entrypoint files; supporting reads may name files or reference directories. It checks package commands and basic Cursor manifest JSON/identity, without importing Matt's Claude manifest schema, docs buckets, or version alignment requirements.

Tests use temporary local repositories and local remotes only. They do not contact upstream, services, or installed settings. These checks prove structural invariants and staging command behavior, not imported workflow quality, model qualification, installed discovery, or Cursor runtime compatibility.

## Staging helper

Once the entire enclosing source repository is clean, including untracked files, with no merge, rebase, cherry-pick, revert or sequencer operation in progress:

```bash
npm run update:upstream
```

The helper verifies its owning component from its own script location before Git operations, discovers and verifies the enclosing repository, records source branch and HEAD, fetches the configured `upstream`, and refreshes the default branch using `git remote set-head upstream --auto`. It never guesses `main`, including when the cached remote HEAD is missing or stale. An unavailable upstream/default branch is a blocker. Logs name the remote, never its URL; remote command output and diagnostics are suppressed because they can contain credentials.

If there are upstream-only commits, it creates a unique sibling worktree of the **repository root**, on a new branch from source HEAD, then merges with `--no-commit --no-ff`. Git hooks are disabled. The source branch and files stay untouched (fetch updates Git remote metadata). Already-current sources create no stage. Conflicts and failures retain the stage and print inspection commands; reconcile an earlier stage before preparing another, rather than accumulating overlapping work.

Before running checks it stops for:

- Any merged change outside `pstack/`. Other plugins and repository-level changes require broader scope authorization, even if pstack checks would pass.
- Changed executable files, symlinks (including dangling links), scripts (including uppercase extensions, skill scripts and extensionless shebang files), nested npm configuration/lockfiles, or package metadata beyond version. Exact paths come from NUL-delimited Git records without trimming; both old and new modes are reviewed. Rename detection is disabled for classification, so deletions and rename sources cannot bypass review. Review these changes before manually running their code in staging. The helper has no bypass flag.

After the scope/code gate, `npm run check` and `npm test` run only in staging's `pstack/`. It also checks diff whitespace and runs `node ~/.pi/agent/lib/skill-adoption.mjs check --cwd <ORIGINAL_PSTACK_COMPONENT>` against the actual installed baseline. Missing or failing adoption checks retain the stage and block activation. Do not reset locks, grant trust, install resources, or edit settings to make a result pass. This original-component check does **not** simulate staged content as installed.

After the initial source-state gate passes, the helper rechecks original branch, HEAD, whole-repository cleanliness and pending Git operations before emitting final evidence, including on later blockers. A branch switch at the same commit also invalidates preparation. It never commits, applies to the source branch, pushes, installs, removes a worktree, changes settings/trust, or resets decision locks. It is not a sandbox: local Git configuration, filters, npm configuration, and reviewed check commands can have side effects.

## Shared primitives and preparation evidence

`scripts/lib/fork-updater.mjs` is a reviewed, byte-identical vendored copy of `agent-skills/harness/fork-updater.mjs`. Its SHA-256 is pinned in `scripts/lib/fork-updater.sha256` and checked by the offline test suite. Update the module and digest together only from the reviewed canonical source; no runtime import from a neighboring checkout is needed. Before adopting a shared-source change, run the coordinator's read-only distribution gate against this component: `node /home/jack/git/agent-skills/harness/sync-fork-updater.mjs --check "$PWD"`. Canonical drift is a blocker, separate from the offline pinned-digest check. It owns hook-safe subprocesses, exact Git path/change records, file-review classification, check records and final evidence formatting. Pstack owns component scope, default-branch discovery, validator commands, source-state guards and Pi-only maintenance policy.

The final `Preparation evidence:` JSON records source repository/component, branch and HEAD, upstream target ref/HEAD, retained stage/branch, checks with outcomes, `notRun` labels and outstanding `prerequisites`. The summary is generated from this record only after final source rechecks. Status meanings:

- `already-current`: no upstream-only commits; no stage or validators.
- `conflict`, `scope-blocked`, `review-required`: stage retained; no validation code run.
- `validation-failed`: one or more local checks failed; later successes do not erase failures.
- `activation-blocked`: adoption or another preparation prerequisite failed, or source identity/state changed.
- `prepared`: local checks and original adoption gate passed; not integrated, activated or qualified.

A changed Cursor manifest prints the compatibility limitation even if scope/code review blocks checks. For this personal Pi-only fork, Cursor and Claude runtime validation are not preparation or activation gates. Retain JSON/identity and other structural checks; Cursor and Claude compatibility remain unverified. A `prepared` result does not authorize activation or claim non-Pi compatibility. The helper attempts all listed local validators and the original adoption check after scope/code review, retaining every outcome.

## Retained-stage recovery

The agent owns recovery; printed commands are gate reminders, not permission to run unreviewed upstream code. Resolve conflicts, review the complete delete/add and mode delta, obtain broader scope authorization where required, and review changed executable/configuration code before running any stage validators.

After that review, substitute the recorded paths and source HEAD:

```bash
git -C <STAGE_REPOSITORY> status
git -C <STAGE_REPOSITORY> diff <RECORDED_SOURCE_HEAD> --no-renames
cd <STAGE_REPOSITORY>/pstack
npm run check
npm test
git diff --check <RECORDED_SOURCE_HEAD>
node ~/.pi/agent/lib/skill-adoption.mjs check --cwd <ORIGINAL_PSTACK_COMPONENT>
```

These commands are not the complete activation decision: also review proposed dependencies, enabled selection and invocation changes against the qualified baseline and validate affected Pi behavior as appropriate. Changed Cursor manifests retain structural checks, but unavailable Cursor or Claude tooling does not block Pi-only maintenance. Non-Pi compatibility remains unverified. The original adoption check does not test the stage as installed. Any edits invalidate earlier checks; rerun relevant gates on the final reviewed content.

Before integration, confirm the original source branch and HEAD still match the evidence, the entire source is clean, and no merge/rebase/cherry-pick/revert/sequencer state exists. A stale result must be reconciled, not integrated on the strength of earlier passing checks.

## Review before activation

Inspect the retained merge and its dependencies, exact enabled selection, invocation boundaries, and side effects against the last qualified Pi configuration. If Cursor manifest metadata changed, the helper reports the limitation: local checks are not Cursor's installed plugin/runtime validation. No Cursor or Claude runtime activation gate applies to Pi-only use. If non-Pi plugin distribution is explicitly requested later, assess and validate that separate target runtime before publication; this repair does not establish that compatibility.

Under the owner's update request, only after review and applicable activation gates pass, commit the reviewed stage, recheck source branch/HEAD/cleanliness and pending operations, then deliberately integrate the reviewed result into the intended live branch. Recheck installed selection and discovery afterward; follow-up evidence cannot replace pre-activation review. Pushing remains a separate request. Preserve failed or unresolved stages and report the smallest prerequisite needed to continue.
