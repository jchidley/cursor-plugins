---
name: ask-pstack
description: Choose a pstack skill or workflow for your situation, explain the route, and identify Pi compatibility or availability gaps.
disable-model-invocation: true
---

# Ask Pstack

Recommend a route through pstack, as ask-matt does for Matt's skills. Routing is read-only by default. Do not start the recommended workflow unless the user's request also asks you to execute it.

## Find the route

1. Identify the user's outcome from the request and current context. Ask a focused question only if the missing answer changes the route.
2. Use the map below to choose the smallest sufficient route. Read the candidate's sibling `../<directory>/SKILL.md` before recommending it. For workflows not covered here, inspect `../../README.md` and the sibling skill frontmatter. Read the matching playbook if recommending poteto-mode.
3. Check which version is available in the session and the trusted project/personal Pi package selections. Package filters select directories; the `name` field determines `/skill:name`. Distinguish a bundled skill from an enabled skill. Do not recommend a different collection's same-named skill as if it were pstack's.
4. Identify prerequisites in the candidate. Cursor Task calls, model aliases, sticky modes, built-in skills, and cursor-team-kit integrations are not automatically available in Pi. Name unresolved dependencies and propose an available alternative only when it preserves the required outcome. Never invent a tool or weaken a review or approval gate.
5. Reply with one recommended route, why it fits, its prerequisites, and the next invocation when available. Offer one alternative only when there is a material tradeoff. If the skill is filtered out, give its source path and explain that enabling it requires a configuration change. Do not edit configuration merely to answer a routing question.

## Route map

| Situation | Start with | Follow with when needed |
|---|---|---|
| Understand how existing code works | `how` | `why` for rationale; `blast-radius` before changing it |
| Establish why a decision was made | `why` | `how` to explain the mechanism |
| Design module boundaries and caller usage | `architect` | `arena` for competing designs |
| Examine a proposed change adversarially | `interrogate` | `blast-radius` for downstream effects |
| Split independent work across workers | `swarm` | `arena` when workers compete on the same outcome |
| Verify a performance claim | `benchmark-checklist` | The perf or hillclimb playbook for sustained investigation |
| Create or maintain live project verification | `create-verification-skill` | `maintain-verification-skill` after drift |
| Clean up prose | `unslop` | `technical-writing` for document structure |
| Restate the last message plainly | `bro` | No larger workflow required |
| Reconstruct prior working context | `recall` | `show-me-your-work` for a new decision trail |
| Capture recurring corrections | `correct` | `reflect` for learnings from a completed run |
| Capture a personal working style | `automate-me` | Review the proposed skill before enabling it |
| A multi-step task requiring a playbook | `poteto-mode` | Its matching playbook; `figure-it-out` if none fits |
| Teach a codebase or use pstack's TDD | `teach` or `tdd` | These may be excluded globally in favor of Matt's versions |
| Apply a focused engineering principle | Matching `principle-*` skill | Read its leaf rather than invoking an entire mode |

## Pi boundaries

Use `/skill:<declared-name>` for enabled Pi skills. Installation of this package supplies skill files, not Cursor's runtime. Follow the session's actual tools, authenticated model registry, and approval rules. A router never grants permission to push, deploy, delete data, or perform other external writes.

Keep the map aligned with the sibling skills when adding, removing, or renaming workflows. The source files are authoritative when the map and installed version differ.
