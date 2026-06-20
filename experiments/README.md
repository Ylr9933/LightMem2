# Experiments

This directory contains the benchmark adapters, reproduction entrypoints, and
benchmark-specific documentation for the current LightMem2 runtime path.

Large benchmark assets and experiment outputs are stored outside Git so that
repository clones stay lightweight.

## What stays in the repository

The repository keeps:

- benchmark task definitions
- grader code
- experiment-side scripts
- runtime adapters
- environment notes
- reproduction READMEs

The repository does **not** keep the full public asset bundles or large
experiment result dumps.

## External experiment storage

Shared experiment storage lives on Google Drive:

- <https://drive.google.com/drive/u/0/folders/1AeMW693aMhyBKscUDbaxnrXfvE8aSBXg>

Recommended top-level layout on Drive:

```text
LightMem2/
└── TokenPilot/
    ├── experiment-data/
    │   ├── pinchbench/
    │   │   └── dataset-assets/
    │   └── claw-eval/
    │       ├── general-bundle/
    │       └── task-fixtures/
    └── experiment-results/
        ├── pinchbench/
        │   ├── isolated/
        │   └── continuous/
        └── claw-eval/
            ├── isolated/
            └── continuous/
```

Use `experiment-data/` for benchmark inputs and `experiment-results/` for
produced outputs, logs, tables, and merged result artifacts.

## Public benchmark index

- [experiments/tokenpilot/README.md](./tokenpilot/README.md)
- [experiments/tokenpilot/pinchbench/README.md](./tokenpilot/pinchbench/README.md)
- [experiments/tokenpilot/claw-eval/README.md](./tokenpilot/claw-eval/README.md)

## Before you reproduce anything

Complete the root-level runtime setup first:

1. follow the installation instructions in the repository [README.md](../README.md)
2. make sure `openclaw` is already runnable in your shell
3. confirm that the current TokenPilot runtime component is installed and usable
4. download the required benchmark data bundle(s) from the shared Google Drive
5. place the bundle(s) into the benchmark-local directories described below

The benchmark directories assume the runtime path is already working before you
start reproduction.

## Recommended workflow

1. Choose the benchmark you want to reproduce.
2. Open the benchmark-specific README.
3. Download the matching `experiment-data` bundle from Google Drive.
4. Copy the bundle into the local benchmark directory expected by the scripts.
5. Run the official baseline or method runner from that subtree.
6. Save large outputs under your local run directories, then upload the final
   result bundle to the matching `experiment-results` folder on Drive.

The canonical public entrypoints are:

- `experiments/tokenpilot/pinchbench/scripts/run_baseline.sh`
- `experiments/tokenpilot/pinchbench/scripts/run_method.sh`
- `experiments/tokenpilot/claw-eval/scripts/run_baseline.sh`
- `experiments/tokenpilot/claw-eval/scripts/run_method.sh`

## Local mount points

### PinchBench

- benchmark README:
  - [experiments/tokenpilot/pinchbench/README.md](./tokenpilot/pinchbench/README.md)
- local asset mount point:
  - `experiments/tokenpilot/pinchbench/dataset/assets/`
- recommended Drive source:
  - `LightMem2/TokenPilot/experiment-data/pinchbench/dataset-assets/`
- recommended Drive result sink:
  - `LightMem2/TokenPilot/experiment-results/pinchbench/`

### Claw-Eval

- benchmark README:
  - [experiments/tokenpilot/claw-eval/README.md](./tokenpilot/claw-eval/README.md)
- local asset mount points:
  - `experiments/tokenpilot/claw-eval/dataset/general/`
  - `experiments/tokenpilot/claw-eval/dataset/tasks/*/fixtures/`
- recommended Drive source:
  - `LightMem2/TokenPilot/experiment-data/claw-eval/general-bundle/`
  - `LightMem2/TokenPilot/experiment-data/claw-eval/task-fixtures/`
- recommended Drive result sink:
  - `LightMem2/TokenPilot/experiment-results/claw-eval/`

## Notes

- The root README gives the public project overview.
- This directory is the top-level entry for experiment reproduction.
- Exact benchmark commands, asset requirements, and pitfalls remain documented
  in each benchmark subtree.
