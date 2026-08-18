## Agent: Common Project Context Resolution

Agent skills should run this step **only when they need configuration values they don't already have**. If a value (for example, agent root, environment, project endpoint, or agent name) is already known from the user's message or a previous skill in the same session, skip resolution for that value.

### Step 1: Discover Agent Roots and azd Context

First check whether the workspace has `azure.yaml` with services using `host: azure.ai.agent`.

- **One azd agent service** -> use that service's `project` folder as the agent root.
- **Multiple azd agent services** -> require the user to choose the target service/folder.
- **No azd agent service** -> search the workspace for `.foundry/` folders that contain `agent-metadata.yaml` or `agent-metadata.<env>.yaml`.
  - **One match** -> use that agent root.
  - **Multiple matches** -> require the user to choose the target agent folder.
  - **No matches** -> for create/deploy workflows, seed a new `.foundry/` folder during setup; for all other workflows, stop and ask the user which agent source folder to initialize.

After selecting an agent root, keep all local `.foundry` cache inspection, source inspection, evaluator suggestions, dataset suggestions, and prompt-optimization context inside that folder only. Do **not** scan sibling agent folders unless the user explicitly switches roots.

### Step 2: Resolve Environment and Deployment Context

If `azure.yaml` is present, resolve the azd environment first:

1. Environment explicitly named by the user
2. `AZURE_ENV_NAME` from `azd env get-values`
3. azd default environment from `.azure/config.json`
4. Environment already selected earlier in the session

Run `azd env get-values` for the selected environment when project/deployment values are not already known. Prefer azd values for deployment context:

| azd Variable | Resolves To |
|-------------|-------------|
| `AZURE_AI_PROJECT_ENDPOINT` or `AZURE_AIPROJECT_ENDPOINT` | Project endpoint |
| `AGENT_<SERVICE>_NAME` | Agent name for the selected azd service |
| `AGENT_<SERVICE>_VERSION` | Agent version for the selected azd service |
| `AZURE_CONTAINER_REGISTRY_NAME` or `AZURE_CONTAINER_REGISTRY_ENDPOINT` | ACR registry name / image URL prefix |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | App Insights connection string for trace workflows |
| `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `AZURE_AI_ACCOUNT_NAME`, `AZURE_AI_PROJECT_NAME` | Azure resource lookup and Playground links |

When azd supplies these values, use them as the source of truth and do not copy them into `.foundry/agent-metadata*.yaml` on metadata writes.

### Step 3: Select Metadata Overlay and Resolve Environment

Inside the selected agent root, choose the metadata file in this order:
1. Metadata filename or path explicitly provided by the user or workflow
2. If an explicit environment is already known and `.foundry/agent-metadata.<env>.yaml` exists, use that file
3. `.foundry/agent-metadata.yaml`
4. If multiple metadata files remain and no rule above selects one, prompt the user to choose

Read the selected metadata file and resolve any remaining environment choice in this order:
1. Environment explicitly named by the user
2. If the selected metadata file defines exactly one environment, use it
3. Environment already selected earlier in the session
4. `defaultEnvironment` from metadata

If the selected metadata file still contains multiple environments and none of the rules above selects one, prompt the user to choose. Keep the selected agent root, metadata file, environment, and whether context came from azd or metadata visible in every workflow summary.

If the selected environment exposes older `testSuites[]` metadata but not `evaluationSuites[]`, treat `testSuites[]` as the source for this session and normalize each entry in memory to the `evaluationSuites[]` shape before continuing. If the metadata is older still and only exposes legacy `testCases[]`, normalize that list the same way. Preserve dataset and evaluator fields, keep any existing `tags`, and map legacy `priority` to `tags.tier` only when `tags.tier` is missing: `P0` -> `smoke`, `P1` -> `regression`, `P2` -> `coverage`.

### Step 4: Resolve eval.yaml Local Evaluation Intent

If `eval.yaml` exists in the selected agent root, parse it before generating new suites:

- `agent.name` -> target agent candidate; verify it matches the selected azd/metadata agent before using it.
- `dataset.local_uri` -> local seed dataset candidate; legacy `dataset_file` may be normalized in memory.
- `dataset.name` / `dataset.version` -> registered dataset candidate.
- `validation_dataset` -> optional validation dataset candidate.
- `evaluators[]` -> candidate Foundry evaluator names; verify with `evaluator_catalog_get` before treating them as remote evaluators.
- `name` -> local eval/suite candidate; verify remotely before persisting as `suiteName`.
- `options.eval_model`, `options.optimization_model`, `options.max_candidates`, `options.optimization_config.model_search_space`, `options.pass_threshold`, `max_samples`, `trace_days`, and `generation_instruction` -> setup defaults.

Treat `eval.yaml` as local evaluation intent, not proof that a Foundry suite exists. Persist synced suite/dataset/evaluator references to `.foundry` only after remote lookup or registration succeeds.

### Step 5: Resolve Common Configuration

Layer sources in this order:

1. Explicit user input and values already selected in the session
2. azd environment values for deployment context
3. `.foundry/agent-metadata*.yaml` overlay values and remote suite/cache references
4. `azure.yaml` and `eval.yaml` local source configuration
5. User prompts for anything still missing

If azd and metadata both provide the same value and they differ, stop and ask which source is authoritative. If they match, use the azd value and avoid rewriting the duplicate on future metadata writes.

| Effective Value | Preferred Source | Used By |
|-----------------|------------------|---------|
| Project endpoint | azd env | deploy, invoke, observe, trace, troubleshoot |
| Agent name/version | azd agent variables, then `azure.yaml` | invoke, observe, trace, troubleshoot |
| ACR | azd env | deploy |
| Evaluation suites and cache paths | `.foundry/agent-metadata*.yaml` | observe, eval-datasets |
| Local seed dataset/evaluator intent | `eval.yaml` | observe, eval-datasets |

### Step 6: Write Metadata Overlay (Create/Deploy/Observe Only)

On any metadata write (deploy, auto-setup, dataset refresh, or trace-to-dataset update), persist only non-derivable overlay/cache state in the selected metadata file:

- azd binding (`azd.environmentName`, `azd.service`) when useful for future resolution
- `evaluationSuites[]` with remote suite/dataset/evaluator references and local cache paths
- `lastEval`, result files, comparison summaries, or explicit non-azd overrides

Do not copy azd-owned deployment values into metadata when azd already provides them. If the selected file is a preferred single-environment file, rewrite only that one environment block. If the selected file is a legacy multi-environment file, rewrite only the selected environment block. Never copy or merge environments across sibling metadata files automatically. If the selected environment still uses older `testSuites[]` or legacy `testCases[]`, rewrite it to `evaluationSuites[]` and remove migrated `priority` fields from the rewritten entries.

### Step 7: Collect Missing Values

Use the `ask_user` or `askQuestions` tool **only for values not resolved** from the user's message, session context, metadata, or azd bootstrap. Common values skills may need:
- **Agent root** — Target azd service project folder or folder containing `.foundry/agent-metadata*.yaml`
- **Metadata file** — `agent-metadata.yaml` for local/dev, or an explicit sidecar such as `agent-metadata.prod.yaml`
- **Environment** — azd environment, `dev`, `prod`, or another environment key from metadata
- **Project endpoint** — Microsoft Foundry project endpoint URL
- **Agent name** — Name of the target agent

> 💡 **Tip:** If the user already provides the agent path, environment, project endpoint, or agent name, extract it directly — do not ask again.
