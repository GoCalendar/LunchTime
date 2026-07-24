---
name: update-product-docs
description: Review LunchTime implementation changes for product-document impact and update the canonical PRD or Policies before a pull request. Use after completing work, before creating or updating a PR, or whenever a change affects user-visible behavior, room lifecycle, permissions, data retention, P2P synchronization, security, notifications, Baemin handoff, history, or error and recovery behavior.
---

# Update Product Docs

Keep implementation and the canonical documents aligned in the same change. Treat `docs/prd/` as the source of truth for product requirements and `docs/policies/` as the source of truth for behavioral rules and exceptions.

## Workflow

1. Determine the comparison base.
   - Prefer the PR base branch supplied by the user or environment.
   - Otherwise use the merge base with `origin/main`.
   - Inspect both committed and uncommitted changes.
2. Read `README.md`, affected PRD and Policies, and the referenced Product Definition documents.
3. Classify the change using the impact rules below.
4. Update every affected canonical document in the same working tree.
   - If the caller explicitly requests a read-only audit, do not edit. Report the exact documents and contracts that need changes instead.
5. Preserve traceability by keeping relevant F-ID, D-ID, requirement IDs, policy IDs, and links.
6. Run `node .agents/skills/update-product-docs/scripts/validate-product-docs.mjs`.
   - For an explicitly out-of-scope Markdown artifact, pass a repeatable `--exclude <relative-path>` argument and list every exclusion in the report.
7. Report one of:
   - which PRD or Policies were updated and why;
   - `문서 변경 불필요` with concrete evidence from the diff.
   - for a read-only audit, `문서 변경 필요` with exact file/contract findings.

## Impact Rules

Update PRD when the change alters:

- user-visible capabilities, screens, flows, inputs, outputs, or MVP scope;
- supported platforms, integrations, performance expectations, or product constraints;
- acceptance criteria or behavior promised to users.

Update Policies when the change alters:

- lifecycle, state transitions, cutoffs, permissions, or reversibility;
- validation, conflicts, failures, recovery, synchronization, or acknowledgement rules;
- retention, deletion, encryption, trust boundaries, notifications, or edge cases.

Update Product Definition only when an explicit product decision, rationale, assumption, or unresolved question changes. Do not use it as a substitute for PRD or Policies.

Documentation usually does not need an update for refactoring, formatting, tests that only cover existing behavior, or build tooling with no product impact. Verify that conclusion against the actual diff.

## Guardrails

- Do not silently rewrite a product decision to match accidental implementation behavior.
- If code conflicts with canonical documents and the requested change does not authorize a product change, stop and report the conflict.
- Do not invent missing product decisions. Record the unresolved point in `docs/product-definition/10_decision_backlog.md` when appropriate.
- Do not create empty document directories or placeholder files.
- Do not duplicate full requirements inside a PR description. Link the canonical document and summarize only the changed contract.
- Keep chat content, secrets, tokens, local Git settings, and personal machine paths out of committed documentation.
- Do not silently exclude files from validation. Use `--exclude` only for paths the caller explicitly placed out of scope and report them.

## PR Handoff

Include a concise section in the PR summary:

```text
Product Docs
- PRD: updated / no change
- Policies: updated / no change
- Product Definition: updated / no change
- Validation: passed
```
