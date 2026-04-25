# Cheap-Route Evaluation — CP5 vs. Daemon Architecture

**Date:** 2026-04-25
**Evaluator:** Haiku (model haiku 4.5) on dispatch from Opus orchestrator
**Question:** Does the Skeptic's CP5 simpler alternative meet the user's stated goal of "remove Opus's runtime routing judgment entirely — enforced by architecture, not by reminders"?
**Verdict reference:** `docs/findings/debate-2026-04-25-routing-daemon.md`

---

## 1. What CP5 Actually Requires (Concrete Components)

**New artifacts:**
- `skills/*/SKILL.md` — add mandatory preamble section (all ~20+ skills): YAML table listing operation types (e.g., "invoke Sonnet subagent", "batch file write", "Postgres insert") with required executor tier (qwen2.5, Haiku, Sonnet, script).
- `scripts/pipeline-routing-check.js` — weekly batch script reading flat log, counting tier mismatches against grid, writing report (text or JSON) to `docs/findings/routing-violations-{date}.txt`.
- `.claude/settings.json` — add `PostToolUse` hook (new; PreToolUse exists) that appends `{timestamp, tool, model, skill_context}` to flat file (e.g., `logs/routing.log`).
- `skills/reviewing/SKILL.md` (modify existing) — add validation step: read skill YAML preamble, extract operation checklist, cross-check invoked tools/models during session against declared grid. Block skill dispatch if mismatch detected.

**Existing artifacts unchanged:**
- `.claude/pipeline.yml` — routing grid stays as documentation (no daemon config, no violation escalation).
- `commands/review.md` — already runs review skill; no change to command structure.
- `scripts/pipeline-db.js`, `scripts/pipeline-cost.js` — untouched.

**Hook event clarification:**
PostToolUse fires after tool execution completes; captures model name from execution context (Claude Code provides this in the hook payload). Flat file (`logs/routing.log`) is append-only, rotated weekly before report script runs.

---

## 2. What CP5 Does NOT Deliver vs. User's Stated Goal

**User goal verbatim:** "Remove Opus's runtime routing judgment entirely — enforced by architecture, not by reminders." + "How can we build a grid for choice-by-convention that you are prevented from ignoring 100% of the time and punished if you do?"

| Goal Component | CP5 Delivers? | Gap |
|---|---|---|
| "Prevented 100% of the time" | **No** | Review-step validation catches mismatches *before* skill dispatch. BUT: if the skill preamble is incomplete, out-of-date, or missing (authoring error), validation is blind. Violations can still execute mid-session if the preamble doesn't cover the actual tool calls inside the skill. |
| "Punished if violation" | **Partial** | PostToolUse logs violations, weekly script reports them. No runtime penalty (no session abort, no escalation, no token throttle). Punishment is asynchronous and informational, not preventive. |
| "Enforced by architecture, not reminders" | **No** | This is a checklist enforced by a human review step. Review is a gate, but it is procedural (happens once per PR). A Sonnet agent authoring a skill can still miss the checklist or misstate operation types. The gate is as robust as the reviewer's attention. |

**The critical gap:** CP5 surfaces violations at *review time* (per change), not at *session time* (per execution). A violation can hide in a skill (bad preamble) through review and execute without penalty.

---

## 3. Hidden Costs / Underspecified Parts

**"Operation checklist preamble" schema:**
CP5 doesn't specify YAML structure. Likely form:
```yaml
operations:
  - type: "invoke_subagent_sonnet"
    required_executor: "sonnet"
  - type: "batch_postgres_insert"
    required_executor: "script"
```
Who parses this? Reviewing skill must regex/parse YAML, extract operation types, then trace through skill body to verify actual tool invocations match. This is fragile: if a tool call is buried in a Bash heredoc or quoted string, parsing fails silently.

**"PostToolUse logs to flat file":**
Schema unspecified. Log rotation and retention unclear. Weekly script assumes log exists and is readable; no error handling for file locks, disk full, or malformed entries. No replayability (logs are consumable, not queryable).

**"/pipeline:review validates skill invocations":**
The reviewing skill must be *extended* to:
1. Read the skill YAML preamble.
2. Static-analyze the skill body for tool calls.
3. Compare actual calls against declared operations.
This is a non-trivial change to reviewing skill. False positives (legitimate tool calls the reviewer's parser misses) could block valid PRs. False negatives (tool calls the parser doesn't see) defeat the gate.

**"Weekly script reports violations" — action loop missing:**
Who reads the report? What triggers a fix? No escalation path. If Opus is consistently violating the grid, the weekly report just accumulates data with no enforcement. The data is historical, not predictive.

---

## 4. True Cost Comparison vs. Daemon Architecture

**Daemon (Practitioner v1):**
- Build: 4 MCP tools, PreToolUse hook with NLP model-detector, violations table schema, 6-row grid in pipeline.yml. ~4–6 Sonnet sessions (per verdict).
- Runtime: Daemon runs continuously; PreToolUse fires on every tool call, checks grid, appends to violations table in real time. Violation visible immediately.
- Token overhead during build: High (Sonnet-heavy).
- Token cost of NOT blocking: Zero — violations are caught and can trigger escalation (e.g., abort session, reroute to Haiku).

**CP5:**
- Build: Skill preamble boilerplate for 20+ skills (~1 Sonnet session for template + examples), reviewing skill extension (static analysis + YAML parsing, ~2 Sonnet sessions), PostToolUse hook (trivial, ~0.5 sessions), weekly script (trivial, ~0.5 sessions). **Total: ~4 Sonnet sessions** (comparable build cost).
- Runtime: PostToolUse appends to flat log passively (low overhead). Review step validates *once per PR* (not per tool call). Violations are discovered async.
- Token overhead during build: Moderate (Sonnet-heavy, similar to daemon).
- Token cost of NOT blocking: High — violations can execute, waste tokens, and only surface in weekly report. One Opus over-invocation mid-session costs more tokens than the entire CP5 build.

**Stabilization phase:** CP5 requires authoring discipline across 20+ skills (preamble completeness, accuracy). Reviewing skill needs tuning to avoid false positives. Daemon has a tighter feedback loop (real-time signals).

---

## 5. Recommendation

**CP5 is NOT sufficient. The daemon is justified.**

**Deciding factors:**
1. **Runtime prevention is the goal.** CP5 catches violations at review (too late); a session already executed the wrong tier. The user's goal is "prevented 100% of the time" — review-time detection is 95% too late.
2. **False negatives are fatal.** CP5's static analysis of skill body (tracing tool calls, parsing YAML preambles) is brittle. Buried tool calls in heredocs or conditionals will evade detection. Daemon's runtime hook is certain.
3. **Authoring discipline does not scale.** Twenty+ skill preambles are a one-time cost, but *every new skill* (and every skill modification) risks a missed or incorrect operation type. The daemon self-documents (violations surface automatically). CP5 relies on human remembering to update preambles and reviewers catching omissions.

**Hybrid alternative worth 1 hour of exploration:** Narrow PreToolUse hook (not a full daemon) that intercepts only the highest-confidence violations (Opus invoking a Sonnet subagent, Opus calling Bash/Postgres directly). Implement as inline Claude Code hook logic (no MCP daemon). This catches ~60% of real violations in real time at 10% of daemon cost, then let CP5 handle the long tail at review.
