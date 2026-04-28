# PinchBench Dataset Migration Status

## Scope

This note summarizes the current status of replacing TokenPilot's old local
PinchBench subset with the mirrored upstream dataset under:

- `experiments/pinchbench/dataset/`

It is a status snapshot, not the full migration checklist.

## Current Status

The upstream PinchBench dataset has now been mirrored into TokenPilot as the
active local dataset.

Current state:

- upstream `tasks/`, `assets/`, and `tasks/manifest.yaml` have been synced
- the local loader supports manifest-driven ordering and categories
- all `123` upstream task files load successfully in the local harness
- local default policy no longer excludes `gws`, GitHub, or image tasks

## Completed Migration Work

The following migration blockers have been resolved:

- old 23-task subset replaced by the upstream 123-task dataset
- manifest-driven task loading restored
- task asset path mismatch in `task_session_chain_analysis` fixed
- `fws` lifecycle support restored for `gws` and GitHub-backed tasks
- local benchmark runtime can reach `gws`, `gh`, and `fws`
- host exec policy updated so baseline runs are not blocked by restrictive local approvals
- `task_image_identification` no longer depends on an upstream private answer key

## Validation Completed

The following special-case tasks have been validated with real baseline runs:

- `task_gws_email_triage`
- `task_gws_cross_service`
- `task_gws_task_management`
- `task_gh_issue_triage`
- `task_image_identification`

What this means:

- service-backed `gws` and GitHub tasks are runnable in the local harness
- image identification is runnable under a TokenPilot-local fixed-answer grading variant
- these tasks are no longer dataset-migration blockers

## Important Caveat

This does not mean all `123` tasks have been individually smoke-tested.

What is true:

- the dataset is structurally migrated
- known special integration cases have been repaired and validated

What is not yet true:

- every upstream task has been individually verified by execution

Remaining unknowns are now mostly validation coverage questions rather than
obvious dataset-integrity failures.

## Practical Conclusion

From a dataset-migration perspective, the replacement is now effectively
complete.

The remaining questions are mainly:

- whether to run a broader all-task smoke pass
- whether to keep any runtime-policy distinctions for default suites
- whether any task-specific behavior differences should be treated as agent/runtime issues rather than dataset issues

## Key References

- [PinchBench Dataset Replacement Checklist](./pinchbench-dataset-replacement-checklist.md)
- [Local Policy](/mnt/20t/xubuqiang/EcoClaw/TokenPilot/experiments/pinchbench/dataset/tasks/local_policy.yaml)
- [GWS/GitHub validation result](/mnt/20t/xubuqiang/EcoClaw/TokenPilot/experiments/pinchbench/save/isolated/baseline/raw/10259_kuaipao-gpt-5-4-mini.json)
- [Image identification validation result](/mnt/20t/xubuqiang/EcoClaw/TokenPilot/experiments/pinchbench/save/isolated/baseline/raw/10263_kuaipao-gpt-5-4-mini.json)
