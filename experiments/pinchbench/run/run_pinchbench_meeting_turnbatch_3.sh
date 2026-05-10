#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PINCHBENCH_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
ESTIMATOR_ENV_FILE="${SCRIPT_DIR}/estimator.env"

if [[ -f "${ESTIMATOR_ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ESTIMATOR_ENV_FILE}"
fi

MEETING_SUITE="${PINCHBENCH_MEETING_SUITE:-task_meeting_advisory_acronyms,task_meeting_advisory_attendees,task_meeting_advisory_stakeholders,task_meeting_advisory_technical,task_meeting_advisory_timeline,task_meeting_blog_post,task_meeting_council_budget,task_meeting_council_contact_info,task_meeting_council_neighborhood,task_meeting_council_public_comment,task_meeting_council_upcoming,task_meeting_council_votes,task_meeting_executive_summary,task_meeting_follow_up_email,task_meeting_gov_controversy,task_meeting_gov_data_sources,task_meeting_gov_next_steps,task_meeting_gov_qa_extract,task_meeting_gov_recommendations,task_meeting_gov_speaker_summary,task_meeting_searchable_index,task_meeting_sentiment_analysis,task_meeting_tech_action_items,task_meeting_tech_competitors,task_meeting_tech_decisions,task_meeting_tech_messaging,task_meeting_tech_product_features,task_meeting_tldr}"
OUTPUT_DIR="${PINCHBENCH_MEETING_OUTPUT_DIR:-${PINCHBENCH_ROOT}/save/continuous/method/meeting_turnbatch_3}"
PINCHBENCH_TMP_ROOT="${PINCHBENCH_TMP_ROOT:-/tmp/pinchbench_meeting_turnbatch_3}"
SOURCE_OPENCLAW_HOME="${TOKENPILOT_OPENCLAW_HOME:-/home/xubuqiang}"
SOURCE_OPENCLAW_CFG="${OPENCLAW_CONFIG_PATH:-${SOURCE_OPENCLAW_HOME}/.openclaw/openclaw.json}"
RUNTIME_OPENCLAW_HOME="${PINCHBENCH_RUNTIME_OPENCLAW_HOME:-${PINCHBENCH_TMP_ROOT}/openclaw_home}"
OPENCLAW_HOME="${RUNTIME_OPENCLAW_HOME}"
OPENCLAW_CFG="${OPENCLAW_HOME}/.openclaw/openclaw.json"
OPENCLAW_STATE_DIR="${OPENCLAW_HOME}/.openclaw"
# Keep the estimator env focused on estimator settings. For the actual agent
# model route, prefer the same shorthand/provider-based path as the known-good
# baseline meeting runs instead of inheriting TOKENPILOT_MODEL from estimator.env.
METHOD_MODEL="${PINCHBENCH_METHOD_MODEL:-${TOKENPILOT_METHOD_MODEL:-gpt-5.4-mini}}"
METHOD_JUDGE="${PINCHBENCH_METHOD_JUDGE:-${TOKENPILOT_METHOD_JUDGE:-gpt-5.4-mini}}"
METHOD_PARALLEL="${TOKENPILOT_PARALLEL:-1}"
METHOD_TIMEOUT="${TOKENPILOT_TIMEOUT_MULTIPLIER:-1.0}"
METHOD_RUNS="${TOKENPILOT_RUNS:-1}"

echo "[meeting-turnbatch] suite=meeting(28 tasks)"
echo "[meeting-turnbatch] batch=3"
echo "[meeting-turnbatch] output_dir=${OUTPUT_DIR}"
echo "[meeting-turnbatch] source_openclaw_home=${SOURCE_OPENCLAW_HOME}"
echo "[meeting-turnbatch] runtime_openclaw_home=${OPENCLAW_HOME}"
echo "[meeting-turnbatch] tmp_root=${PINCHBENCH_TMP_ROOT}"

rm -rf "${PINCHBENCH_TMP_ROOT}"
mkdir -p "${PINCHBENCH_TMP_ROOT}"
mkdir -p "${OPENCLAW_HOME}"

if [[ -d "${SOURCE_OPENCLAW_HOME}/.openclaw" ]]; then
  cp -a "${SOURCE_OPENCLAW_HOME}/.openclaw" "${OPENCLAW_HOME}/.openclaw"
else
  echo "Missing source OpenClaw state dir: ${SOURCE_OPENCLAW_HOME}/.openclaw" >&2
  exit 1
fi

# Keep runtime config/providers/plugins, but start with a clean agent/session
# store so continuous benchmark runs do not inherit stale agent metadata or
# absolute sessionFile pointers from the source home.
rm -rf "${OPENCLAW_STATE_DIR}/agents"
mkdir -p "${OPENCLAW_STATE_DIR}/agents"

# The copied config carries a large historical agents.list with absolute agentDir
# pointers back into the source home. Clear that metadata so benchmark runs only
# see agents created inside this tmp runtime home.
python3 - "${OPENCLAW_CFG}" "${METHOD_MODEL}" <<'PY'
import json
import sys

config_path = sys.argv[1]
method_model = sys.argv[2]

with open(config_path, "r", encoding="utf-8") as fh:
    data = json.load(fh)

agents = data.setdefault("agents", {})
defaults = agents.setdefault("defaults", {})
model_cfg = defaults.setdefault("model", {})
models_cfg = defaults.setdefault("models", {})

model_cfg["primary"] = method_model
model_cfg["fallbacks"] = []
if method_model not in models_cfg:
    models_cfg[method_model] = {}

agents["list"] = [{"id": "main"}]

with open(config_path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
PY

(
  cd "${REPO_ROOT}"
  TOKENPILOT_OPENCLAW_HOME="${OPENCLAW_HOME}" \
  OPENCLAW_CONFIG_PATH="${OPENCLAW_CFG}" \
  OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR}" \
  pnpm plugin:install:release
)

TOKENPILOT_SESSION_MODE=continuous \
TOKENPILOT_RUNS="${METHOD_RUNS}" \
TOKENPILOT_ENABLE_REDUCTION=true \
TOKENPILOT_ENABLE_EVICTION=true \
TOKENPILOT_TASK_STATE_ESTIMATOR_ENABLED=true \
TOKENPILOT_TASK_STATE_ESTIMATOR_BATCH_TURNS=3 \
TOKENPILOT_TASK_STATE_ESTIMATOR_LIFECYCLE_MODE=decoupled \
TOKENPILOT_TASK_STATE_ESTIMATOR_EVICTION_PROMOTION_POLICY=fifo \
TOKENPILOT_TASK_STATE_ESTIMATOR_EVICTION_PROMOTION_HOT_TAIL_SIZE=1 \
TOKENPILOT_REDUCTION_PASS_REPEATED_READ_DEDUP=false \
TOKENPILOT_REDUCTION_PASS_TOOL_PAYLOAD_TRIM=false \
TOKENPILOT_REDUCTION_PASS_HTML_SLIMMING=false \
TOKENPILOT_REDUCTION_PASS_EXEC_OUTPUT_TRUNCATION=false \
TOKENPILOT_REDUCTION_PASS_AGENTS_STARTUP_OPTIMIZATION=false \
TOKENPILOT_EXEC_ASK=off \
TOKENPILOT_OPENCLAW_HOME="${OPENCLAW_HOME}" \
OPENCLAW_CONFIG_PATH="${OPENCLAW_CFG}" \
OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR}" \
PINCHBENCH_TMP_ROOT="${PINCHBENCH_TMP_ROOT}" \
"${PINCHBENCH_ROOT}/scripts/run_method.sh" \
  --model "${METHOD_MODEL}" \
  --judge "${METHOD_JUDGE}" \
  --suite "${MEETING_SUITE}" \
  --runs "${METHOD_RUNS}" \
  --parallel "${METHOD_PARALLEL}" \
  --timeout-multiplier "${METHOD_TIMEOUT}" \
  --session-mode continuous \
  --output-dir "${OUTPUT_DIR}"
