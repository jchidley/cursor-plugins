# Pstack component workspace

## Scope and repository

- This directory is the intentional component-level Pi session root. Start pstack sessions consistently from `~/git/cursor-plugins/pstack`; `~/git/pstack` is a convenience symlink to the same files.
- The enclosing Git repository is `~/git/cursor-plugins`, the personal fork of `cursor/plugins`. Keep personal adaptations on its `pi` branch; check `git status --short --branch` before editing and preserve unrelated work.
- Keep work within `pstack/` unless broader changes are requested. Personal/project Pi selections belong in their configuration, not this collection. Coordinate shared configuration changes with other active sessions.

## Validation

- Run `git diff --check` and review `git diff -- .` from this directory after changes.
- Run `npm run check` and `npm test` from this component directory. For invocation, dependency, or selection changes, also run `node ~/.pi/agent/lib/skill-adoption.mjs check --cwd "$PWD"` when available. This installed adoption check is separate from the local structural and offline regression checks; report unavailable checks and drift as blockers.
- Validate affected workflows with the installed target runtime as appropriate. Static checks do not establish model-specific workflow quality; do not incur paid evaluation costs without authorization.

## Upstream adaptations

- Keep collection-specific Pi adaptations and supporting documentation here; see `docs/pi.md` for packaging, invocation policy, and compatibility limits.
- Skills are user-invoked by default. Starting a workflow permits its declared supporting instructions within the requested task, not independent workflows, broader scope, or separately controlled actions.
- This checkout is live. Prepare upstream updates or changes requiring pre-activation evaluation in a separate worktree, review and validate the adoption delta, then deliberately integrate approved changes into `pi`. Do not merge upstream into the live checkout first and treat later checks as an activation gate.
- Preserve explicit selection and invocation decisions, record remaining compatibility/qualification limits, and do not push without authorization.
- When asked “Update this fork from upstream and keep my customizations,” own the maintenance procedure in [docs/fork-maintenance.md](docs/fork-maintenance.md): reconcile retained staging work, preserve local work, review scope/code and conflicts, run checks, commit and integrate the reviewed local result after activation gates pass, and report concrete blockers rather than returning the procedure as homework. `npm run update:upstream` prepares a retained stage only; it never commits, activates, installs, changes settings/trust/locks, or pushes. Changes outside `pstack/` require broader authorization.
