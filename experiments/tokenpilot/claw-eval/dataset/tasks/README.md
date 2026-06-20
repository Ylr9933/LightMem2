# Claw-Eval task fixtures

This directory keeps the task definitions and graders in Git:

- `task.yaml`
- `grader.py`

Large task-local fixture payloads are stored outside Git:

- `fixtures/` media files
- task-local PDFs and OCR inputs
- task-local JSON fixture bundles
- generated `output.html` reference files

## Source of truth

Google Drive root:

- <https://drive.google.com/drive/u/0/folders/1AeMW693aMhyBKscUDbaxnrXfvE8aSBXg>

Recommended Drive path:

```text
LightMem2/TokenPilot/experiment-data/claw-eval/task-fixtures/
```

## Expected restore layout

After download, each task should restore its local fixture tree under:

```text
experiments/tokenpilot/claw-eval/dataset/tasks/<task-id>/fixtures/
```

If a task ships a committed `task.yaml` and `grader.py` but no local `fixtures/`
directory, download the matching fixture subtree from Drive before running the
benchmark.
