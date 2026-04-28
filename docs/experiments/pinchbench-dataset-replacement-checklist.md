# PinchBench Dataset Replacement Checklist

## Goal

Replace TokenPilot's current local PinchBench subset under:

- `experiments/pinchbench/dataset/`

with the current upstream PinchBench dataset from:

- `/mnt/20t/xubuqiang/EcoClaw/pinchbench`

while keeping TokenPilot's benchmark harness usable for:

- OpenClaw-hosted generation
- TokenPilot plugin/runtime comparison
- staged validation instead of blind full activation

This is not a small task sync. It is a dataset model migration.

## Current Reality

### Local TokenPilot dataset

- `23` tasks
- numbered task IDs such as:
  - `task_00_sanity`
  - `task_01_calendar`
- filename-scan loading
- local wrappers and saved results still shaped around the narrowed subset

### Current upstream PinchBench dataset

- `123` tasks
- manifest-driven ordering and categorization
- task files are now:
  - `tasks/manifest.yaml`
  - `tasks/task_*.md`
- canonical task IDs are now manifest-style IDs such as:
  - `task_sanity`
  - `task_calendar`
  - `task_stock`

### Immediate implication

This is no longer:

- "copy a few new task files"

It is:

- task format continuity check
- task ID migration
- suite/default policy redesign
- unsupported service-backed task exclusion

## Source Of Truth

The replacement source should be treated as a unit:

- upstream `tasks/`
- upstream `assets/`
- upstream `tasks/manifest.yaml`

Do not replace `tasks/` alone.

## What Changed Upstream

### 1. Task count exploded

The local subset is no longer representative.

Upstream now includes large families of tasks that do not exist locally:

- CSV analysis tasks
- log analysis tasks
- meeting analysis tasks
- additional coding tasks
- additional research/productivity tasks
- integration-backed tasks

### 2. Task IDs changed

Old local numbering is not canonical anymore.

Examples:

- local `task_00_sanity` -> upstream `task_sanity`
- local `task_01_calendar` -> upstream `task_calendar`
- local `task_02_stock` -> upstream `task_stock`

### 3. Ordering and categories moved into `manifest.yaml`

The upstream manifest now owns:

- global task ordering
- category membership
- `run_first`

### 4. Some upstream tasks require support we do not currently restore or finish

Initially unsupported on day 1:

- `task_gws_email_triage`
- `task_gws_cross_service`
- `task_gws_task_management`
- `task_gh_issue_triage`
- `task_image_identification`

Current status after migration work:

- `task_gws_email_triage`: runnable
- `task_gws_cross_service`: runnable
- `task_gws_task_management`: runnable
- `task_gh_issue_triage`: runnable
- `task_image_identification`: runnable with TokenPilot-local fixed-answer grading

## Non-Negotiable Migration Rules

### Rule 1: Sync the upstream dataset as a unit

Sync together:

- `tasks/`
- `assets/`
- `tasks/manifest.yaml`

Reason:

- task files now reference many additional asset trees
- partial sync will produce broken `workspace_files.source` references

### Rule 2: Treat task ID migration as breaking

Do not pretend old and new IDs are interchangeable.

Required:

- update local suite references
- update wrappers that still mention numbered IDs
- treat old result trees as legacy

### Rule 3: Keep an explicit disabled-task list

After sync, not every upstream task should become active immediately.

We need a tracked TokenPilot-owned policy layer:

- supported tasks
- excluded tasks
- exclusion rationale

### Rule 4: Validate in layers

Do not promote the upstream dataset in one step.

Validation order should be:

1. automated tasks without external services
2. hybrid tasks without external services
3. multi-session tasks
4. service-backed tasks

## Required Work

### A. Dataset sync

- copy upstream `tasks/` into `experiments/pinchbench/dataset/tasks/`
- copy upstream `assets/` into `experiments/pinchbench/dataset/assets/`
- copy upstream `tasks/manifest.yaml` into the local dataset tree

### B. Loader migration

Patch:

- `experiments/pinchbench/dataset/scripts/lib_tasks.py`

Required behavior:

- `manifest.yaml` is the canonical source of ordering
- `manifest.yaml` is the canonical source of categories
- `run_first` is respected
- filename globbing remains only as fallback/debug behavior

### C. Task ID migration

Audit and update:

- wrapper defaults
- suite filters
- matrix scripts
- report naming assumptions
- docs that still mention numbered subset IDs

Expected result:

- local execution surfaces should accept upstream manifest-style IDs
- old numbered IDs should be treated as legacy only

### D. Grading compatibility

Patch or restore where needed:

- `experiments/pinchbench/dataset/scripts/lib_grading.py`

Must check:

- automated checker compatibility against new assets/tasks
- hybrid grading prompt compatibility

Current state:

- `task_image_identification` no longer depends on upstream private answer-key staging
- it now uses a TokenPilot-local fixed-answer mapping for the three bundled images
- explicit baseline validation completed successfully for `task_image_identification`

### E. External service support decision

Make an explicit decision for:

- `fws` / `gws`-backed tasks
- GitHub mock-service-backed tasks

If not restoring support immediately:

- exclude them explicitly
- do not let them silently fail in default suites

Current state:

- `fws` lifecycle support restored in the local harness
- `gws` and `gh` CLIs installed and reachable from benchmark runtime
- host exec policy updated so baseline runs are not blocked by host-local allowlist misses
- explicit baseline validation completed for:
  - `task_gws_email_triage`
  - `task_gws_cross_service`
  - `task_gws_task_management`
  - `task_gh_issue_triage`

## Recommended Initial Exclusion Set

Before service-backed support is restored, begin with these excluded:

- `task_gws_email_triage`
- `task_gws_cross_service`
- `task_gws_task_management`
- `task_gh_issue_triage`

This list may shrink later.

Updated recommendation after validation:

- `task_gws_*` and `task_gh_issue_triage` no longer need to be treated as migration blockers
- `task_image_identification` no longer needs to be treated as a migration blocker
- whether they stay in the default suite is now a runtime-policy choice, not a dataset-integrity issue

## Recommended Phase Plan

### Phase 1: Dataset sync only

Deliverables:

- upstream `tasks/`
- upstream `assets/`
- upstream `manifest.yaml`

Do not flip default suites yet.

### Phase 2: Manifest-aware loader

Deliverables:

- local loader respects manifest ordering/categories
- basic task listing works against upstream IDs

At the end of this phase, the dataset can be loaded correctly, but not all tasks
should be considered runnable yet.

### Phase 3: Compatibility suite

Create a local supported-suite control file or equivalent policy layer.

First target:

- automated
- non-service-backed
- no upstream-private grading dependency

This becomes the safe first active suite.

### Phase 4: Validation pass

For each candidate task:

- workspace staging works
- transcript extraction works
- raw JSON shape is stable
- automated grading works
- continuous mode behavior is acceptable where relevant

### Phase 5: Expand support

Only after the first compatibility suite is stable:

- promote already-restored service-backed tasks into the default supported suite if desired
- widen default suite if desired

Validation result so far:

- service-backed `gws` / GitHub mock tasks have been migrated successfully and are runnable
- baseline isolated smoke test completed successfully on the following explicit suite:
  - `task_gws_email_triage`
  - `task_gws_cross_service`
  - `task_gws_task_management`
  - `task_gh_issue_triage`
- `task_image_identification` has also been validated successfully under the TokenPilot-local fixed-answer grading variant
- this confirms the remaining score differences are agent/runtime behavior, not dataset wiring failure

## Default Suite Decision After Migration

Do not let this drift implicitly.

After replacement, decide explicitly whether TokenPilot should default to:

- `automated-only`
- a curated supported suite
- all non-excluded upstream tasks

Current recommendation:

- keep a curated supported suite first
- do not jump directly to "all 123 tasks"

## Result Handling Policy

Old result trees and old task labels should be treated as legacy.

Reason:

- task IDs changed
- category composition changed
- task count changed
- manifest ordering changed

Do not mix:

- old numbered-subset results
- new manifest-dataset results

in one analysis bucket.

## Concrete Next Actions

### Immediate

1. sync upstream `tasks/`, `assets/`, `manifest.yaml`
2. patch `lib_tasks.py` for manifest-aware loading
3. add a tracked local supported/excluded task policy

### After that

4. run automated non-service-backed compatibility sweep
5. patch grading incompatibilities
6. migrate suite/wrapper references from numbered IDs to manifest IDs

### Only later

7. restore private image-key staging
8. reconsider expanding the default active suite
9. decide whether `gws` / GitHub-backed tasks should join the default supported suite or remain opt-in

## Bottom Line

The upstream PinchBench refresh is a:

- `23 -> 123` task expansion
- numbered-ID -> manifest-ID migration
- filename-scan -> manifest-driven loader migration

The correct path is:

- sync first
- load correctly
- activate conservatively
- validate in layers

not:

- overwrite local tasks and hope the old harness still means the same thing
