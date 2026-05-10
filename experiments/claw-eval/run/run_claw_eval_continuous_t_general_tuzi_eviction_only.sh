#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPERIMENT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT_ROOT="$(cd "${EXPERIMENT_ROOT}/../.." && pwd)"

OPENCLAW_HOME="${TOKENPILOT_OPENCLAW_HOME:-/home/xubuqiang}"
OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-${OPENCLAW_HOME}/.openclaw/openclaw.json}"
MODEL="${CLAW_EVAL_MODEL:-tokenpilot/gpt-5.4-mini}"
JUDGE_MODEL="${CLAW_EVAL_JUDGE_MODEL:-${MODEL}}"
TUZI_BASE_URL="${TUZI_BASE_URL:-https://coding.tu-zi.com/v1}"
TUZI_API_KEY="${TUZI_API_KEY:-}"

if [[ -z "${TUZI_API_KEY}" ]]; then
  echo "Missing TUZI_API_KEY in environment." >&2
  exit 2
fi

echo "[0/3] ensure tuzi upstream provider in ${OPENCLAW_CONFIG_PATH}"
python3 - <<'PY' "${OPENCLAW_CONFIG_PATH}" "${TUZI_BASE_URL}" "${TUZI_API_KEY}"
import json, pathlib, sys
cfg_path = pathlib.Path(sys.argv[1])
base_url = sys.argv[2]
api_key = sys.argv[3]
doc = json.loads(cfg_path.read_text())
doc.setdefault("models", {}).setdefault("providers", {})
providers = doc["models"]["providers"]
providers["tuzi"] = {
    "baseUrl": base_url,
    "apiKey": api_key,
    "api": "openai-responses",
    "models": [
        {
            "id": "gpt-5.4-mini",
            "name": "gpt-5.4-mini",
            "reasoning": True,
            "input": ["text", "image"],
            "contextWindow": 128000,
            "maxTokens": 8192,
        },
        {
            "id": "gpt-5.4",
            "name": "gpt-5.4",
            "reasoning": True,
            "input": ["text", "image"],
            "contextWindow": 128000,
            "maxTokens": 8192,
        },
    ],
}
cfg_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2))
print("updated", cfg_path)
PY

echo "[1/3] install plugin"
cd "${PROJECT_ROOT}"
TOKENPILOT_OPENCLAW_HOME="${OPENCLAW_HOME}" \
OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH}" \
pnpm plugin:install:release

echo "[2/3] run claw-eval continuous t-general with eviction+estimator only"
echo "model=${MODEL}"
TOKENPILOT_ENABLE_REDUCTION=false \
TOKENPILOT_ENABLE_EVICTION=true \
TOKENPILOT_TASK_STATE_ESTIMATOR_ENABLED=true \
TOKENPILOT_EVICTION_REPLACEMENT_MODE="${TOKENPILOT_EVICTION_REPLACEMENT_MODE:-drop}" \
CLAW_EVAL_MODEL="${MODEL}" \
CLAW_EVAL_JUDGE_MODEL="${JUDGE_MODEL}" \
bash "${EXPERIMENT_ROOT}/scripts/run_method.sh" \
  --scope t-general \
  --session-mode continuous \
  --profile custom
