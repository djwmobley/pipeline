---
name: init-azure-devops
description: Verify Azure DevOps organization, project access, and process-template configuration during /pipeline:init Step 1c. Dispatched as a subagent via the Task tool when the git remote resolves to dev.azure.com or *.visualstudio.com. Runs scripts/pipeline-init-azure-devops.js, interprets az CLI errors via the error-interpretation table in this skill, and returns a structured verification result for init.md to apply to pipeline.yml's platform block.
operation_class: code_draft
allowed_models: [sonnet]
allowed_direct_write: true
---

## Purpose

Separate LLM-cognitive error interpretation (this skill) from mechanical `az` CLI invocation (the helper script). The parent `/pipeline:init` command dispatches this skill via Claude Code's `Task` tool when the detected platform is `azure-devops`. The subagent runs the helper, interprets `az` exit codes and stderr strings against the error table, and emits a structured JSON block that init.md parses to populate `platform.azure_devops.*` in pipeline.yml — or to surface actionable errors to the user.

---

## Dispatch contract

### Input

The parent command passes a single block of text with these values:

- `remote_url` (string, required) — the full git remote URL, e.g., `https://dev.azure.com/contoso/MyProject/_git/myrepo` or `https://contoso.visualstudio.com/MyProject/_git/myrepo`.
- `quick_mode` (boolean, required) — whether `/pipeline:init` was invoked in `--quick` mode. Governs degradation behavior on failure (see "Quick-mode degradation" below).

### Output

The subagent's **final message MUST be a single fenced JSON code block** matching this schema, with no prose after it. init.md parses the last fenced `json` block in the reply.

```json
{
  "verified": true,
  "platform_config": {
    "organization": "contoso",
    "project": "MyProject",
    "process_template": "Agile",
    "work_item_type": "Task",
    "done_state": "Closed",
    "active_state": "Active"
  },
  "errors": [],
  "logs": ["extension_check ok (0.28s)", "account_show ok (0.41s)", "project_show ok (0.63s)", "process_template=Agile"]
}
```

On failure:

```json
{
  "verified": false,
  "platform_config": null,
  "errors": [
    {
      "stage": "project_show",
      "code": "TF400813",
      "cause": "PAT lacking Work Items (Read & Write) scope",
      "user_action": "Regenerate your Azure DevOps PAT with Work Items (Read & Write) and Code (Read & Write) scopes, then set AZURE_DEVOPS_EXT_PAT or run `az login`.",
      "install_command": null
    }
  ],
  "logs": ["extension_check ok (0.27s)", "account_show ok (0.38s)", "project_show FAIL (0.52s): TF400813"]
}
```

The `errors` array may hold multiple entries when the failure chain has several interpretable stages (e.g., extension missing AND auth unset). Populate in the order they were encountered by the helper.

---

## Process flow

```
 parent /pipeline:init invokes Task tool
        │
        ▼
 ┌──────────────────────────────────┐
 │ 1. Parse remote_url → {org, prj} │  ← regex, two URL forms
 └──────────────────────────────────┘
        │
        ▼
 ┌──────────────────────────────────┐
 │ 2. node pipeline-init-azure-     │  ← helper, 3 sequential az calls
 │    devops.js verify --org ...    │
 └──────────────────────────────────┘
        │
        ▼
 ┌──────────────────────────────────┐
 │ 3. Walk steps[], map each        │  ← error-interpretation table
 │    non-zero exit_code/stderr to  │
 │    {stage, code, cause, action}  │
 └──────────────────────────────────┘
        │
        ├── all steps ok ──┐
        │                  ▼
        │         ┌─────────────────────────────────┐
        │         │ 4. detect-process-template      │
        │         │ 5. map template → state names   │
        │         │ 6. set-defaults (az global cfg) │
        │         │ 7. emit verified=true JSON      │
        │         └─────────────────────────────────┘
        │
        └── any step failed ──┐
                              ▼
                   ┌─────────────────────────────┐
                   │ 8. emit verified=false JSON │
                   │    with errors[] populated  │
                   └─────────────────────────────┘
```

---

## URL parsing

Two forms to handle:

| Pattern | Example | Extraction |
|---------|---------|------------|
| `https://dev.azure.com/{org}/{project}/_git/{repo}` | `https://dev.azure.com/contoso/My Project/_git/myrepo` | org=`contoso`, project=`My Project` |
| `https://{org}.visualstudio.com/{project}/_git/{repo}` | `https://contoso.visualstudio.com/MyProject/_git/myrepo` | org=`contoso`, project=`MyProject` |

The project segment may contain URL-encoded characters (e.g., `%20` for space). URL-decode before passing to the helper.

If the URL doesn't match either pattern, emit `verified=false` with a single error:
```json
{"stage": "url_parse", "code": null, "cause": "URL did not match dev.azure.com or *.visualstudio.com patterns", "user_action": "Verify remote URL with `git remote get-url origin`; supported forms are https://dev.azure.com/{org}/{project}/_git/{repo} and https://{org}.visualstudio.com/{project}/_git/{repo}", "install_command": null}
```

---

## Helper invocation

```bash
node '[SCRIPTS_DIR]/pipeline-init-azure-devops.js' verify --org '[org]' --project '[project]'
```

Parse the stdout JSON. The `steps` array contains up to three entries in order: `extension_check`, `account_show`, `project_show`. Each has `{stage, bin, args, exit_code, stdout_first_line, stderr_first_line, duration_ms, timed_out?}`.

If the helper itself exits non-zero (e.g., `az CLI not found on PATH`), treat stderr as a single error:
```json
{"stage": "az_not_found", "code": null, "cause": "Azure CLI not installed or not on PATH", "user_action": "Install Azure CLI from https://aka.ms/installazurecli, then re-run /pipeline:init", "install_command": null}
```

If all three steps return `exit_code: 0`, the helper's JSON tells you `verify` passed. Proceed to `detect-process-template`:

```bash
node '[SCRIPTS_DIR]/pipeline-init-azure-devops.js' detect-process-template --org '[org]' --project '[project]'
```

The output's `process_template` field is the raw template name (`Basic` | `Agile` | `Scrum` | `CMMI` | custom).

Then `set-defaults`:

```bash
node '[SCRIPTS_DIR]/pipeline-init-azure-devops.js' set-defaults --org '[org]' --project '[project]'
```

This persists `organization=https://dev.azure.com/{org}` and `project={project}` into the user's global `az devops` config (`az devops configure --defaults`). Mutates user state — matches the current init.md behavior at line 226, not a new side-effect.

---

## Error-interpretation table

Map each step's `exit_code` and `stderr_first_line` to an error entry. Codes like `TF400813` appear in the stderr when the Azure DevOps backend rejects a request.

| Trigger in step output | Stage | Code | Cause | User action | Install command |
|---|---|---|---|---|---|
| Helper exits non-zero with "az CLI not found" | `az_not_found` | `null` | Azure CLI not installed | Install Azure CLI from https://aka.ms/installazurecli | `null` (OS-specific installer) |
| `extension_check` `exit_code != 0` with stderr containing "ExtensionNotInstalled" or "extension with name ... not installed" or empty stdout | `extension_check` | `ExtensionNotInstalled` | `azure-devops` extension not installed for Azure CLI | Install the extension with the command below | `az extension add --name azure-devops` |
| `account_show` `exit_code != 0` with stderr containing "Please run 'az login'" | `account_show` | `AuthRequired` | Not logged in to Azure | Run `az login`, OR set `AZURE_DEVOPS_EXT_PAT` env var with a PAT that has Work Items + Code scopes | `null` |
| `project_show` stderr containing `TF400813` | `project_show` | `TF400813` | PAT lacking Work Items (Read & Write) scope | Regenerate your Azure DevOps PAT with Work Items (Read & Write) and Code (Read & Write) scopes; re-run `az login` or set `AZURE_DEVOPS_EXT_PAT` | `null` |
| `project_show` stderr containing `TF400818` or "project with name ... could not be found" | `project_show` | `TF400818` | Project not found in the specified organization | Verify org and project names in the git remote URL; correct the URL or update the Azure DevOps project | `null` |
| `project_show` stderr containing `TF401027` or "unauthorized" | `project_show` | `TF401027` | Unauthorized — PAT is valid but does not grant access to the project | Request access to the project, OR regenerate PAT for an account that has access | `null` |
| Any step `timed_out: true` | (step name) | `Timeout` | Network timeout reaching Azure DevOps (10s limit) | Check VPN/connectivity; corporate networks often require VPN to reach `dev.azure.com` | `null` |
| Any step `exit_code != 0` and stderr does not match any row above | (step name) | `Unknown` | Unrecognized `az` error | Include the stderr first line in your troubleshooting: `[stderr_first_line]` | `null` |

**Redaction rule:** the subagent MUST NOT include the value of `AZURE_DEVOPS_EXT_PAT` in any output, even if it appears somehow in stderr. Strip any substring matching `[A-Za-z0-9+/=]{40,}` from stderr before including it in error messages. The helper only reports `azure_devops_ext_pat_set: true|false` in `env_vars` and never the value.

---

## Process-template → state-name table

On `verified: true`, resolve `done_state` and `active_state` from the detected `process_template`:

| Process Template | done_state | active_state |
|-----------------|------------|-------------|
| Basic | Done | Doing |
| Agile | Closed | Active |
| Scrum | Done | Committed |
| CMMI | Closed | Active |

**If the detected template is not in this table** (custom process template), emit `verified: true` but include a non-blocking advisory:

```json
{
  "verified": true,
  "platform_config": {
    "organization": "contoso",
    "project": "CustomProject",
    "process_template": "CustomTemplate",
    "work_item_type": "Task",
    "done_state": null,
    "active_state": null
  },
  "errors": [
    {"stage": "process_template_unknown", "code": null, "cause": "Process template 'CustomTemplate' not in the known-templates table", "user_action": "Set platform.azure_devops.done_state and active_state manually in .claude/pipeline.yml after init", "install_command": null}
  ],
  "logs": ["process_template=CustomTemplate (unknown — state names nulled)"]
}
```

`work_item_type` defaults to `Task` for all templates. Users can change it via `/pipeline:update` after init.

---

## Quick-mode degradation

When `quick_mode: true` AND `verified: false`:

- Subagent still emits the `verified: false` result with populated `errors[]`.
- The parent `/pipeline:init` command is responsible for interpreting `quick_mode`: it logs the first `user_action`, sets `platform.code_host: "azure-devops"` and `platform.issue_tracker: "none"` in pipeline.yml (partial enablement — git remote works, issue workflows disabled), and falls through without prompting.

The subagent does NOT mutate pipeline.yml or branch behavior on `quick_mode`. It only reports verification results. init.md owns the quick-mode policy.

---

## Red flags / rationalization prevention

| Rationalization | Reality |
|---|---|
| "`az devops project show` succeeded, so the PAT has all the scopes" | No — `project show` only requires Code (Read). Work Item workflows need Work Items scope too. A separate probe via `az boards work-item query` would be the test, but it's noisier. For /pipeline:init, we accept this gap and surface TF400813 at first work-item operation instead. |
| "I can skip `account_show` and go straight to `project_show`" | `account_show` distinguishes "not logged in" from "logged in but wrong project." If you skip it, TF401027 on project_show becomes ambiguous. Run it. |
| "The stderr contains a sensitive-looking token — include it so the user can debug" | Redact. PATs can leak through error paths. Apply the redaction regex. |
| "quick_mode should silently succeed even if verification fails" | No — quick_mode falls through to partial enablement, but the errors[] must still be populated so init.md can log a summary. Silent success loses diagnostic signal. |
| "I'll set sensible defaults for unknown process templates" | Don't. Guessing `done_state` for a custom template can hide work-item-state bugs. null out state fields and surface the advisory; user fixes post-init. |
| "If `az` is missing, I'll fall back to using raw REST calls with curl" | Out of scope for this directive. If az isn't installed, emit `az_not_found` and stop. REST fallback is a future directive. |

---

## Acceptance criteria (for author/Judge)

1. Known-good Azure DevOps project with valid PAT → `verified: true`, correct `process_template`, correct state names.
2. PAT scope error (TF400813) → `verified: false` with `errors[0].code == "TF400813"`.
3. Extension missing → `errors[0].install_command == "az extension add --name azure-devops"`.
4. `az` not on PATH → `errors[0].stage == "az_not_found"`.
5. URL that doesn't match either supported form → `errors[0].stage == "url_parse"`.
6. Custom process template → `verified: true` with `done_state: null`, advisory in `errors[]`.
7. PAT value never appears in errors[], logs[], or platform_config.

---

## Non-scope

- Not validating that work-item states on the board actually match `done_state` / `active_state`. Templates ship with default state names; a project admin can rename them. This skill uses the template-level defaults; `/pipeline:update` can override post-init.
- Not discovering `work_item_type`. Defaults to `Task`. Override via `/pipeline:update` for `Bug`, `User Story`, etc.
- Not pulling the list of available projects in the organization to help the user pick one. init.md handles URL input; this skill trusts what it receives.
- Not handling Azure DevOps Server (on-prem, non-cloud). URL patterns differ; out of scope for v1.0.
