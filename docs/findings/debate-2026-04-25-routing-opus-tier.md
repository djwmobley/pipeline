# Design Debate Verdict (Opus tier): Routing Architecture Choice

**Date:** 2026-04-25
**Spec under debate:** Architectural choice between (A) full daemon, (B) hybrid PreToolUse + CP5, (C) CP5 alone
**Panelists:** 3× Opus (Advocate, Skeptic, Practitioner) — dispatched at Opus tier specifically because user authorized "deepest thinking now for best payoff later"
**Inputs consulted:**
- `docs/specs/2026-04-25-routing-daemon-spec.md` (original spec)
- `docs/findings/debate-2026-04-25-routing-daemon.md` (prior Sonnet-tier verdict)
- `docs/findings/cheap-route-evaluation-2026-04-25.md` (Haiku CP5 evaluation)
**Disposition:** **rethink** — proceed to Option D, not A/B/C

---

## Headline: Independent Convergence on D

The Opus Skeptic and Opus Practitioner — neither seeing the other's output — both rejected A/B/C as specified and proposed a substantively-identical fourth architecture (D). That convergence is the load-bearing finding of this debate.

### What Both Ds Share

- **Routing decisions move from runtime (Opus per-turn judgment) to authoring time (declarative YAML frontmatter on skills).** Skills declare their executor tier in their SKILL.md frontmatter (Skeptic: `allowed-models:`; Practitioner: `operation_class:`). The convention is declared in the file once, by a human, slowly. Runtime is mechanical lookup.
- **Narrow PreToolUse hook does FILE-LOOKUP, not content classification.** "Don't classify, forbid" (Skeptic). The hook reads the dispatching skill's frontmatter and blocks any tool call not declared. No prompt regex. No semantic inspection. No judgment.
- **Block direct-Bash on SQL keywords.** Both Ds keep the high-confidence Bash interceptions (`psql`, `INSERT INTO`, `UPDATE.*SET`, `DROP TABLE`).
- **Block Opus's own Edit/Write above N lines** unless the active skill declares `allowed-direct-write: true` (Skeptic explicit; Practitioner implicit via `operation_class`). This addresses the "Opus drafts directly in its context window before any tool call fires" failure mode that A/B/C all miss.
- **No MCP daemon.** Both Ds explicitly cut the daemon. Postgres writes happen from the hook directly (Skeptic) or from a PostToolUse hook (Practitioner). No long-running node process to manage, no MCP lifecycle complexity, no MCP wrapper around scripts that already exist.
- **No prompt-content classification anywhere.** The "LangChain router trap" (Practitioner) — every system that tried runtime intent classification ended up with a classifier + manual override = judgment behind a renamed door.
- **Build: ~2–3 Sonnet sessions.** Roughly 40–50% of the daemon's true 6–9-session cost (Skeptic's recalibrated estimate including hidden costs A had hand-waved).

### What Both Ds Add That A/B/C Missed

- **Practitioner's bombshell:** "The worst violations happen entirely in Opus's context window before a single tool call fires. No PreToolUse hook can see them." A/B/C cannot prevent in-context drafting because tokens are spent before any hook event. D constrains *what Opus is allowed to produce* by redirecting work through declared-tier skills — Opus's job shrinks to "pick the right skill," and `pipeline-lint-agents.js` (already exists) becomes the static linter that audits skill choice.
- **Skeptic's reframe:** "Rigidity is the feature." A skill that legitimately needs an unanticipated tier is blocked until its frontmatter is updated. That rigidity forces the convention to be declared in the file rather than reasoned at the call site. Convention-not-reason aligned by construction.
- **Single source of truth:** the union of `allowed-models:` (or `operation_class:`) declarations across SKILL.md files IS the grid. No separate `pipeline.yml` `routing:` block to maintain in lockstep with hooks and daemon.

### Where the Two Ds Differ (Minor, Resolvable in Planning)

| | Skeptic D | Practitioner D |
|---|---|---|
| Frontmatter key | `allowed-models: [sonnet]` | `operation_class: short_draft` |
| Op semantics | Per-skill model allowlist | Per-skill operation class → tier mapping |
| Direct Edit/Write | `allowed-direct-write: true` flag | Implicit via `operation_class` |
| Telemetry | `routing_violations` Postgres table from hook | JSONL log + weekly report script |
| Reporting | (Implicit) | `scripts/pipeline-routing-report.js`, surfaced in `/pipeline:finish` |

Resolution: Practitioner's `operation_class` is more semantically rich (one canonical name maps to a tier, allowing tier policy changes without per-skill edits). Skeptic's Postgres telemetry is more durable (survives `/clear`, queryable, embeddable, surfaces in RAG). The composite — Practitioner's frontmatter + Skeptic's telemetry — is the planning input.

---

## Advocate's Position: A with Amendment (Held the Line)

The Opus Advocate defended A (Full Daemon) with one structural amendment: the daemon must be a **pure dispatcher with zero internal routing judgment** — every call site supplies the tier explicitly via an `escalate` flag, and the daemon's only "decision" is a deterministic table lookup keyed by `(operation_type, escalation_flag)`. This is the strongest defense available for A.

**Why the amendment doesn't save A:** Skeptic flagged that this relocates the judgment to the caller. The orchestrator deciding whether to set `escalate=true` IS the per-turn routing judgment we're trying to remove. Advocate proposed visibility-driven honesty (log every `escalate=true` to `routing_violations`, surface in `/pipeline:review`) — but visibility-as-enforcement is exactly what CP5 was rejected for. Honesty enforced by visibility is the same shape as CP5; if it works here, it would have worked there.

**The amendment moves the problem; it does not solve it.** This is the convention-not-reason recursion the prior debate flagged but didn't escape.

---

## Disposition: rethink

The original spec (full daemon, A) and the Haiku-recommended hybrid (B) were both built on the unstated assumption that runtime intent classification is solvable. Both Opus Skeptic and Opus Practitioner — independently — identified this as a convention-not-reason axiom violation hiding inside the architecture. The correct path is not A, not B, not C — it is D.

**Specific architecture to plan:**

1. **Skill SKILL.md frontmatter extension.** Add `operation_class:` (Practitioner naming) declaring the executor tier the skill expects to invoke. Audit the ~22 skills (commands are dispatch shells, not routing surfaces — exclude) and add the field.
2. **Single PreToolUse hook (~50 lines).** Reads the active skill's `operation_class`, looks up the declared tier, blocks any `Agent(model=X)` or `Bash(...)` invocation that doesn't match. Block direct-Bash SQL invariants (`psql`, `INSERT INTO`, `UPDATE.*SET`, `DROP TABLE`) regardless of skill. Block Opus's Edit/Write above N lines unless `allowed-direct-write: true` in the skill frontmatter.
3. **PostToolUse hook (~30 lines).** Append `{timestamp, tool, model, skill, operation_class}` to Postgres `routing_violations` table (Skeptic's durability) AND a JSONL flat-file (Practitioner's simplicity). The Postgres write is one `INSERT` from the hook directly via `node scripts/pipeline-db.js update finding new ...` or a new lightweight verb.
4. **Static linter extension.** Extend `scripts/pipeline-lint-agents.js` (already exists) to validate every skill has `operation_class` declared and the value is a known tier. Run in `/pipeline:lint-agents`.
5. **Reporting.** `scripts/pipeline-routing-report.js` reads JSONL + Postgres table, produces weekly tier-distribution and violation report. Surfaced in `/pipeline:finish` ship summary.

**Defer to v2 (only after v1 logs prove a measured need):**

- MCP daemon. Build only when v1 logs prove a specific high-frequency violation class that cannot be solved by a skill frontmatter declaration.
- Agent-tool prompt classification. Do not enter the LangChain router trap.
- "Conversation turn handling" and "Complex multi-step dispatch" grid rows. Both require runtime prompt classification and must be cut, not debated.

**Cut entirely:**

- Drafting tools (`mcp__router__draft_short`, `mcp__router__draft_code`). They are drafting infrastructure dressed up in routing clothing (Skeptic). Drafting belongs in skills with declared `operation_class`, not in a daemon.
- Bulk skill-body parsing in reviewing-skill (the CP5 fragility).
- "Punishment" framing. A violations table the developer sees once a week is a metric, not punishment (Practitioner). Frame it as one.
- The original spec's 12-row grid in `pipeline.yml routing:`. The grid IS the union of `operation_class:` declarations across SKILL.md files. No separate YAML block.

---

## Points of Agreement (across all 3 Opus panelists)

- The user's goal ("prevented 100% of the time, enforced by architecture") is binary; CP5-style post-hoc surfacing fails the rubric.
- "Conversation turn handling" and "Complex multi-step dispatch" grid rows from the original spec must be cut — they require unsolved prompt classification.
- No GDPR / PCI-DSS / WCAG / OSS licensing constraints apply.
- The original 4-tool MCP daemon overscopes v1; drafting tools (`draft_short`, `draft_code`) are not routing infrastructure.
- The Opus orchestrator's pre-tool-call in-context drafting is a major waste source that A and B both fail to address; D addresses it via skill-level `operation_class` enforcement.
- The convention must be declared in YAML and enforced by mechanical lookup, with NO classifier or judgment in the runtime path.

## Critical Contested Point

**CP1: Is runtime classification of intent (Agent prompt content) ever solvable without recursive judgment?**

- **Advocate:** Yes, with explicit caller-supplied flags + visibility-driven honesty enforcement.
- **Skeptic:** No — caller-supplied flags ARE judgment-relocation; rubber-stamping is the failure mode.
- **Practitioner:** No — track record across LangChain / LiteLLM / OpenAI Assistants / Cursor is "classifier + manual override = judgment behind a different name."

**Resolution:** If Skeptic and Practitioner's framing is correct, A and B are structurally unviable. The Advocate's amendment is the strongest defense available, and even that one collapses under examination. **D is the answer because intent classification at runtime is the wrong problem to solve — the problem is that Opus has classification authority at all, and D removes it.**

## Invalidated Assumptions

- That Opus's pre-tool-call drafting (where the worst violations happen) can be intercepted by ANY hook. **Invalidated by:** Practitioner — "the worst violations happen entirely in Opus's context window before a single tool call fires." Resolution: constrain via skill `operation_class` discipline, not via hooks.
- That "build cost in Sonnet sessions" is the right comparison axis. **Invalidated by:** Skeptic — the 6-month maintenance burden dominates, and A has 3 update surfaces while D has 1.
- That the daemon's escalation logic is a separable concern from the convention-not-reason axiom. **Invalidated by:** Skeptic, Advocate-acknowledged — escalation is the same problem one layer down regardless of whether it's inferred (original spec) or caller-supplied (Advocate's amendment).
- That A's MCP server provides necessary routing affordances. **Invalidated by:** Practitioner — `scripts/pipeline-db.js` already exists and works; the daemon is a wrapper around a wrapper. The drafting tools (`draft_short`, `draft_code`) are scope leak.

## Risk Register

| Risk | Raised By | Likelihood | Required Mitigation |
|------|-----------|------------|---------------------|
| Skill `operation_class` declarations drift out of sync with actual skill behavior | Practitioner | MEDIUM | Static linter (`pipeline-lint-agents.js`) validates every skill declares `operation_class` and value is a known tier; runs in `/pipeline:lint-agents` |
| PreToolUse hook produces false positives on legitimate Bash containing SQL keywords | All 3 | HIGH | Anchor regex on `psql ` and `node scripts/pipeline-db.js update` — high-confidence, narrow patterns; do not classify content |
| Opus orchestrator works around the hook by avoiding the active skill | Skeptic | MEDIUM | Hook fails closed; if no active skill detected, default to `operation_class: opus_orchestration` with strict tier limits |
| Skill-authoring discipline fails — new skills ship without `operation_class` | Practitioner | MEDIUM | Static linter blocks `/pipeline:commit` if any skill lacks `operation_class`; no hand-edit escape |
| Postgres `routing_violations` table grows unbounded | Skeptic | LOW | Existing token tracking pattern handles this; weekly aggregate, archive monthly |
| Telemetry never gets read; weekly report becomes noise | Practitioner | MEDIUM | Surface in `/pipeline:finish` ship summary as required section, not optional |
| `operation_class` taxonomy itself becomes a drift surface (new classes invented per-skill) | (synthesis) | MEDIUM | Closed enum: tier classes are defined in `.claude/pipeline.yml` `routing:` block, validated by linter; new classes require config edit, not skill-author judgment |
| Direct Edit/Write threshold (N lines) fails for legitimate inline writes | Skeptic | LOW | Per-skill override (`allowed-direct-write: true`); audit usage in weekly report |

---

## Position Papers

### Advocate (Opus)

#### Chosen Architecture
**Architecture A (Full Daemon)** with one structural amendment: the daemon must be a *pure dispatcher* with zero internal routing judgment — every call site supplies the tier explicitly, and the daemon's only "decision" is a deterministic table lookup keyed by `(operation_type, escalation_flag)`.

#### Strengths of Chosen Path

**1. PreToolUse hook + MCP daemon is the only combination that satisfies "prevented 100% of the time, enforced by architecture."**

The user's rubric is binary: a violation must be *impossible*, not *unlikely*. Claude Code's hook system is the only enforcement surface in this runtime that can return exit code 2 *before* a tool executes. PostToolUse, skill preambles, review-time scripts, and authoring discipline are all post-violation — by the time they fire, the Sonnet tokens have been spent and the cache has been polluted. The convention-not-reason axiom says runtime reasoning IS drift; the only way to remove drift is to remove the reasoning surface. PreToolUse blocking on `Agent(model=sonnet)` invocations from the orchestrator is that removal.

This implicitly rejects CP5 (C), which logs violations after they happen. CP5 is a metrics dashboard, not an enforcement mechanism. The rejection is sound because the user's words — "prevented 100% of the time and punished if you do" — explicitly require runtime prevention; CP5 punishes after the fact only.

**2. The MCP daemon collapses three update surfaces into one source of truth.**

The prior debate correctly identified that hook rules + daemon op-types + YAML grid can diverge silently. The amendment I am making — daemon as pure dispatcher with table-driven `(op_type, flag) → tier` lookup — solves this. The grid in `.claude/pipeline.yml` becomes the single source. The daemon reads it on startup; the PreToolUse hook reads it on every call. There is no second copy of routing logic anywhere. Adding a new operation type means editing one row in one file.

This implicitly rejects Hybrid (B). B has a hook with inline regex AND skill preambles AND a flat-file log AND review-time validation — four surfaces, no canonical store. Every new violation pattern requires editing at least two places, with no schema enforcement. Drift is guaranteed.

**3. Postgres `routing_violations` table is the only honest punishment mechanism.**

"Punished if you do" requires a durable, queryable, embeddable record. Postgres is already the master store (per the three-store hierarchy in CLAUDE.md). A `routing_violations` row participates in the same RAG/embedding pipeline as decisions and gotchas. A flat file at `logs/routing.log` (B and C) does not — it is invisible to `/pipeline:review`, invisible to RAG, invisible to the dashboard. The user said "punished"; punishment that the orchestrator never sees again is no punishment.

**4. The four MCP tools (`sql`, `classify`, `draft_short`, `draft_code`) replace the four highest-volume Opus rationalization patterns.**

Each tool is a *named affordance* the orchestrator reaches for instead of `Agent(model=...)`. `mcp__router__sql` makes "I'll just write this INSERT myself" route to a script. `mcp__router__classify` makes "this needs Sonnet because it's prose-shaped" route to qwen2.5:14b. The MCP surface is what gives the orchestrator a *correct* path; the hook is what closes the *incorrect* path. Without the affordance, blocking the bad path produces a stuck orchestrator who cannot make progress.

#### Why Other Candidates Are Weaker

**Hybrid (B) — the deciding failure is "no canonical store."** B's claim is "10% of the daemon cost catches 60% of violations." The 60% number is unverified Haiku speculation. More damning: B has no Postgres table, so violations don't embed, don't surface in review, and don't survive `/clear`. The hook fires, the orchestrator sees a transient error, the lesson evaporates. To become viable, B would need to add the Postgres table and the MCP tools — at which point it IS A.

**CP5 alone (C) — the deciding failure is post-violation enforcement.** Haiku itself concluded CP5 fails the rubric. The user said "prevented 100%"; CP5 prevents 0% at runtime. The skill preambles are authoring discipline, which the prior debate correctly identified as unscaling. To become viable, C would need a PreToolUse blocker — at which point it is no longer C.

**The "build cost" comparison is misleading.** Haiku estimated CP5 at ~4 Sonnet sessions and the daemon at 4–6. The marginal cost of the daemon (1–2 sessions) buys runtime prevention, single-source-of-truth, and Postgres punishment. That marginal cost is the cheapest part of the project.

#### Implementation Feasibility

The components are well-defined: MCP node servers are a standard pattern (Anthropic publishes templates); PreToolUse hooks with exit-code blocking are documented in Claude Code's hook spec; the Postgres table is a 4-column migration. Realistic estimate: **5 Sonnet sessions** — 1 for the table migration and grid YAML, 2 for the MCP daemon (with the pure-dispatcher amendment), 1 for the PreToolUse hook (narrow regex on `Agent` tool calls and direct `psql`/`pipeline-db.js update`), 1 for integration tests and the `/pipeline:review` extension to query violations. Rollback is trivial: remove the hook entry from `.claude/settings.json` and the orchestrator returns to current behavior; the daemon and table become inert.

#### Compliance Strengths

GDPR, PCI-DSS, WCAG, and licensing do not apply. This is developer tooling running locally on a single developer's machine; no personal data, no payment data, no public UI, no redistribution. Stated explicitly per calibration rule 2.

#### Risks Accepted

**1. PreToolUse regex false-positives are real.** The prior debate flagged this. A heredoc containing the word `INSERT` will trigger the SQL block; a `cat` of a SQL file will too. Mitigation is conservative regex (anchor on `psql ` and `node scripts/pipeline-db.js update`), not perfect detection. We accept some false positives because the failure mode is "orchestrator must use the MCP tool" — annoying, not destructive.

**2. The daemon's "pure dispatcher" amendment depends on every call site supplying the escalation flag honestly.** If the orchestrator passes `escalate=true` whenever it wants Sonnet, the daemon rubber-stamps. Mitigation: log every `escalate=true` to `routing_violations` with the caller's reason, and surface those in `/pipeline:review`. Honesty is enforced by visibility, not by the daemon.

**3. Two rows from the prior debate (conversation turn handling, complex multi-step dispatch) remain unsolved.** Both require prompt content classification. They must be deferred to v2 explicitly; the v1 grid documents them as `tier=opus, reason=unclassified` so they don't silently default to Sonnet.

**4. Failure mode that hurts most: the daemon crashes silently and the hook fails open.** If the MCP server is down and the hook cannot reach it, the orchestrator proceeds with raw `Agent` calls. Mitigation: hook fails *closed* (exit code 2 with a clear "router daemon unreachable, restart it" message). A stuck orchestrator is the correct failure mode here; a silently-bypassed orchestrator is the one we are trying to eliminate.

### Skeptic (Opus)

#### Scope Concerns Across A, B, C

**Candidate A (Full Daemon)** is scope-bloated v1. Four MCP tools is three too many. `mcp__router__draft_short` and `mcp__router__draft_code` are not routing infrastructure — they are *drafting infrastructure dressed up in routing clothing*. The user's goal is "stop Opus from picking the wrong model"; that is solved by *blocking the wrong invocation*, not by *providing a correct dispatch path*. Once the wrong invocation is blocked, Opus is forced to use the existing dispatch surfaces (Task tool with `model: "sonnet"`, scripts, etc.). Bundling drafting tools into v1 conflates "prevent drift" with "make the corrected path frictionless," and the second problem can be solved later or never. `mcp__router__sql` is similarly overscoped — `scripts/pipeline-db.js` already exists; the daemon adds a wrapper around a wrapper. The 4–6 Sonnet sessions estimate is for the wrapper wrapper, not the rubric-meeting core.

**Candidate B (Hybrid)** smuggles CP5's full long-tail apparatus in the back door. "Skill SKILL.md operation-type preambles + reviewing-skill validation + PostToolUse flat-file log + weekly review script" *is CP5*. B is honestly described as "PreToolUse hook PLUS all of C." The "no MCP daemon" framing makes it sound smaller than A; in build surface area it is roughly A-minus-MCP-plus-C, which is not obviously cheaper.

**Candidate C (CP5)** scopes correctly for what it is — pure post-hoc — but misrepresents itself as a routing architecture. It is a *routing audit tool*. Auditing is not enforcement. The user said "prevented 100% of the time and punished if you do" — C provides 0% prevention and deferred punishment. C's scope problem is that it claims to address the user's rubric and does not.

#### Feasibility Attacks Per Candidate

**A — Full Daemon**

*Design flaw — recursive judgment, surface 2.* Prior debate found the "escalate if judgment needed" clause inside the daemon. Resolution-by-explicit-flags moves the judgment to the *caller* (Opus deciding whether to set the escalation flag). The judgment did not disappear; it migrated up the stack to the exact actor whose judgment the user said is "invariably incorrect." The fix is a relabel.

*Design flaw — PreToolUse cannot read intent.* The hook sees `Agent(model=sonnet, prompt="...")`. To know if the prompt is mechanical, the hook must classify the prompt. Regex on prompt text is the FP/FN failure prior debate already named. The honest options are: (1) classify with an LLM call inside the hook (recursive routing judgment, surface 3), or (2) require Opus to tag every dispatch with an op-type (which is exactly the convention Opus is supposed to follow — and is the same drift surface, just renamed). There is no third option. The daemon cannot read intent without judgment.

*Integration risk — three divergence surfaces.* Hook rules (`.claude/settings.json`), daemon op-types (`scripts/lib/router-daemon.js`), grid YAML (`.claude/pipeline.yml`). The prior debate flagged this and did not resolve it. One developer maintaining three surfaces in lockstep is the convention-not-reason axiom violated structurally.

*Integration risk — MCP server lifecycle.* Project-local MCP servers have a startup/shutdown lifecycle Claude Code manages per session. Daemon-down means *all* tagged operations fail or fall through. Spec does not say which.

**B — Hybrid**

*Design flaw — "highest-confidence violations" are also where Opus already rarely errs.* The user's complaint is that Opus drafts long content directly, picks Sonnet for mechanical work, and reasons at execution time. None of those are `Agent(model=sonnet)` invocations with mechanical-pattern prompts; they are `Edit`/`Write` calls Opus makes itself, or Sonnet dispatches with prompts that *look* judgment-laden and aren't. B catches the easy cases and lets the hard cases ride.

*Design flaw — 60% claim is unsourced.* Haiku's "60% in real time at 10% cost" is not measured; it is asserted. There is no baseline of which violations occur with what frequency. Without that baseline the 60% is a *number-shaped vibe*. Building B because 60% > 0% is not engineering.

*Integration risk — flat-file log is not punishment.* "Logs/routing.log + weekly script" is the same deferred surfacing that makes C fail. The user said *punished*, present tense, immediate.

**C — CP5 Alone**

*Design flaw — fails the rubric on its face.* Zero prevention. The user said 100%. Score: 0/100. Discussion of severity ends here.

*Design flaw — static skill-body analysis is brittle, confirmed by prior Haiku evaluation.* The 20+ SKILL.md preambles are a documentation expansion, not enforcement.

#### Token / Cost Reality Check

| | Build (Sonnet sessions) | Stabilization (FP debug) | 6-month violation cost (untreated drift) | True total |
|---|---|---|---|---|
| A | 4–6 *plus* 2–3 hidden (op-type taxonomy, MCP lifecycle, hook regex tuning) = **6–9** | High — daemon FPs block real work; Opus debugs at Opus tier | Low if it works | **6–9 + debug tail** |
| B | 4–5 (hook + CP5 long tail combined) | Medium — hook FPs only | Medium — long tail untreated | **4–5 + medium tail** |
| C | 4 honest, but with no enforcement | Low | High — drift continues unbounded for 6 months | **4 + ongoing drift cost** |

The honest comparison is not build cost but *expected-violations-prevented per Sonnet-session spent*. A's number is unknown (depends on whether intent-reading works at all). B's number is bounded by Haiku's unsourced 60%. C's number is zero.

**The hidden cost in all three:** every one of these architectures has a maintenance surface that requires Opus tier judgment to keep current. The architectures intended to remove Opus judgment require Opus judgment to maintain. This is the recursive problem the prior debate did not fully name.

#### Maintenance Burden Comparison

- **A:** 3 surfaces × every grid change. Every Claude Code version bump may break MCP or hook contract. One developer cannot keep this current.
- **B:** 2 surfaces (hook + skill preambles). Lower than A. Still nontrivial.
- **C:** 1 surface (preambles) plus a script. Lowest.

None of these survive the one-developer constraint cleanly.

#### The Fourth Option (D)

**D: Hard PreToolUse Allowlist with No Classification.**

The convention-not-reason axiom says reasoning at execution time IS drift. *Any* architecture that requires intent classification at the hook layer is recursive judgment. The escape is: **do not classify. Forbid.**

Concretely:
- One PreToolUse hook. It blocks `Task(model="opus")` and `Task(model="sonnet")` *unconditionally* unless the dispatching skill file declares an `allowed-models:` frontmatter key listing that model. No prompt inspection. No regex on intent. Pure file-level allowlist.
- Skills that legitimately need Sonnet (e.g., `commit-message-drafting`) declare `allowed-models: [sonnet]` in their YAML frontmatter once. Skills that don't, can't dispatch Sonnet — period.
- Opus's *own* `Edit`/`Write` calls above N lines are blocked by the same hook unless the active skill declares `allowed-direct-write: true`. Opus must dispatch a skilled subagent to write longer content. This addresses the Opus-drafts-directly failure mode A and B both miss.
- Postgres `routing_violations` table records every block (1 SQL row, no MCP daemon — call `pipeline-db.js` from the hook directly).
- No daemon. No drafting tools. No grid in YAML other than what already lives in `.claude/pipeline.yml`. The grid is the union of `allowed-models:` keys across skill files — it is the convention, declared structurally where the dispatch happens.

**What D cuts:** MCP server, daemon op-types, intent classification, prompt regex, drafting wrappers, three-surface divergence.

**What D adds that A/B/C lack:** blocking on Opus's *own* writes, not just on dispatches. This is where the actual drift lives.

**Tradeoff:** D is rigid. A skill that legitimately needs an unanticipated model is blocked until its frontmatter is updated. That rigidity *is the feature* — it forces the convention to be declared in the file rather than reasoned at the call site. Build cost: 2–3 Sonnet sessions for hook + frontmatter audit + DB write.

**Convention-not-reason alignment:** D removes runtime judgment entirely. The hook makes a deterministic file lookup. There is no model the hook reasons about; there is a static list per skill. Every "use judgment" that A/B/C smuggle in via prompt classification or op-type tagging is replaced by "what does the SKILL.md frontmatter say." That is a deterministic check, which is exactly what the axiom requires.

D is the option. If D is rejected, **B is least-bad** — not because B works, but because A's recursive judgment problem is structural and C provides no enforcement. B at least blocks something real at runtime, even if the 60% is a vibe.

### Practitioner (Opus)

#### Real-World Context

I have shipped enforcement systems like this before. Three patterns dominate the industry, and exactly zero of them are "MCP daemon plus PreToolUse content classifier."

**Pattern 1: Cursor / Aider / Continue — explicit per-mode model flag.** The user (or a config) names which model handles which mode, then the harness routes. There is no LLM-side "decide which tier to use." The decision was made at config time. This is the exact shape of `.claude/pipeline.yml`'s `models:` block today. It is also the shape of every successful router I have shipped.

**Pattern 2: LangChain / LiteLLM router classifiers.** A small classifier model assigns each request to a tier. This sounds like spec A's daemon, but the production reality is brutal: classifiers misfire on edge cases, and the workaround in every prod system I have seen is a manual override flag. So you end up with a classifier *and* a manual override — i.e., judgment is back, just hidden behind a tool name. The daemon is not eliminating judgment; it is relocating it to a Node process where it is harder to audit.

**Pattern 3: PR-time / commit-time linters (rubocop, semgrep, custom AST checks).** This is what spec C is. It is the most boring and the most successful of the three. It catches the long tail at review time. It does not block in real time and that is fine because the cost of the violation is recoverable.

**Lesson from the ecosystem:** the systems that hold up over years are the ones with the *thinnest* runtime layer and the *fattest* pre-commit / post-commit layer. Anything that requires runtime intent classification — what the daemon's `draft_short` vs `draft_code` vs Sonnet-escalate decision is — has a track record of producing bug reports for a decade. We are not going to do better than LangChain in our spare time.

#### Pipeline Codebase Reality

**A (daemon).** `scripts/lib/router-daemon.js` does not exist. `scripts/lib/shared.js` is 282 lines of config + pg connection helpers — useful for the daemon's SQL tool, but the MCP server itself is greenfield: stdio handler, JSON-RPC framing, tool schema declarations, error envelopes, plus an Ollama HTTP client (does not exist; `pipeline-embed.js` calls Ollama for embeddings only, not chat completion). Realistic accounting: ~600–900 lines of new code, plus the operational overhead of a long-running node process the user has to start, monitor, and restart. The "4–6 Sonnet sessions" estimate is fantasy. This is closer to 8–12, plus a steady stream of bugs once it ships.

**B (hybrid).** Claude Code PreToolUse hooks receive `tool_name` and `tool_input` as JSON on stdin. So:
- `Bash("psql ...")` — detectable via substring match on `tool_input.command`. Cheap. Reliable.
- `Bash("node scripts/pipeline-db.js update ...")` — already in `permissions.allow`, easy substring check.
- `Agent(model=sonnet)` with a "mechanical-task pattern" prompt — **this is the gap**. The hook gets the prompt text, but classifying "is this prompt mechanical?" is the exact judgment problem we are trying to eliminate. Either the hook is dumb (regex on a few keywords, will miss most cases and false-positive others) or it's smart (calls a classifier, and we are back to A).

The high-confidence half of B is genuinely cheap and works. The "Sonnet dispatch interception" half does not work the way the spec implies.

**C (CP5).** Reviewing-skill already exists at `skills/reviewing/SKILL.md`; extending it to parse skill bodies is incremental. PostToolUse logging to a flat file is ~30 lines in a hook. The weak spot is exactly what the user named: do they actually run `/pipeline:review`? Sometimes. The long tail does not get reviewed in practice.

#### What the Orchestrator Actually Does — The Five Violations

| Violation | A (daemon) | B (hybrid) | C (CP5) |
|---|---|---|---|
| Read 520-line `pipeline-embed.js` | **No.** Spec doesn't intercept Read tool. | **No.** Same. | **No.** Logged post-hoc, surfaces at review. |
| Draft `feedback_*.md` in Opus | **Maybe.** Only if the file Write tool routes through `mcp__router__file_write` and the daemon classifies the content as "short prose." Classification = judgment. | **No.** Hook can't tell the Edit tool was preceded by Opus thinking-tokens. | **No.** Same caveat as A. |
| Hand-write SQL INSERT in Bash | **Yes.** Bash + SQL keyword = block. | **Yes.** Same rule, simpler hook. | **No** at runtime; **Yes** at review. |
| Draft 400-word audit prompt | **No.** Drafting happens before any tool call; nothing to intercept. | **No.** Same. | **No.** Same. |
| Dispatch Sonnet for 51-row classification | **Maybe.** Daemon would have to inspect the Agent prompt and classify it as bulk-classification. Judgment. | **No** reliably. Regex on prompt content is brittle. | **No** at runtime; reviewable post-hoc. |

**Score:** A prevents 1 cleanly and 2 with a judgment layer it claims to eliminate. B prevents 1 cleanly. C prevents 0 in real time, catches all 5 at review. **None of the candidates prevent the largest waste source: drafting in Opus before any tool call fires.**

This is the practitioner's bombshell: *the worst violations happen entirely in Opus's context window before a single tool call. No PreToolUse hook can see them.* The only architectural answer is to constrain what Opus is allowed to produce, which is a prompt/skill-discipline problem, not a hook problem.

#### Compliance Reality

GDPR/PCI/WCAG/OSS-licensing — none apply. This is a developer-tooling plugin running locally against a personal Postgres instance. State explicitly: no regulatory exposure.

#### What the Single Developer Actually Needs

The user is one developer fighting their own orchestrator's tier-creep. Friction matters more than completeness.

- **A's friction:** every SQL edit means stopping to call `mcp__router__sql` instead of the muscle-memory `node scripts/pipeline-db.js update ...`. The daemon process has to be running. When it crashes (it will) the developer is locked out of their own DB. Bypass path: comment out the hook. Within a month it will be commented out.
- **B's friction:** medium. The high-confidence rules (psql, direct pipeline-db.js bash) rarely fire because the developer wasn't planning to do those anyway. The Sonnet-dispatch rule will fire on legitimate Sonnet calls and the developer will add overrides. The override mechanism becomes the new judgment surface.
- **C's friction:** near zero at runtime. Cost: violations don't get fixed unless review actually runs.

#### Recommendation: D — Inverted Architecture

I recommend none of A/B/C as specified. The real architecture is:

**v1 (in scope, ~3 Sonnet sessions):**

1. **Move routing decisions out of Opus's context entirely.** Add a `routing_table` section to `.claude/pipeline.yml` mapping operation labels (`sql_write`, `bulk_classify`, `short_draft`, `code_draft`) to executors (`script`, `qwen14b`, `coder32b`, `haiku`, `sonnet`). This already exists embryonically in `models:`.
2. **Extend skill SKILL.md frontmatter with a required `operation_class` field.** Each skill declares its op class. Skills are how Opus routes today; this makes the routing declarative at skill-load time, not per-turn. Update the ~22 skills (not 51 — only skills carry op semantics; commands are dispatch shells).
3. **One PreToolUse hook, narrow scope:** block `Bash` invocations that match `psql `, `INSERT INTO`, `UPDATE.*SET`, `DROP TABLE`. ~40 lines. This catches the cheapest, highest-confidence violation class — direct SQL — and nothing else.
4. **One PostToolUse hook, append-only:** log `tool_name`, model (when available from env), prompt-bytes to `logs/routing.jsonl`. ~30 lines.
5. **A `scripts/pipeline-routing-report.js` script** that reads the JSONL log and produces a weekly tier-distribution report. Run from `/pipeline:finish`.

**Defer (v2+):**

- MCP daemon. Wait until the v1 logs prove a specific high-frequency violation class that *cannot* be solved by a skill frontmatter declaration. Build the daemon to solve a measured problem, not a hypothetical one.
- Agent-tool prompt classification. This is the LangChain-router trap. Do not enter.
- `routing_violations` Postgres table. The JSONL log is sufficient until weekly reports hit a volume that warrants SQL aggregation.

**Cut entirely:**

- Bulk skill body parsing in reviewing-skill. Skill frontmatter `operation_class` makes the parser unnecessary.
- The "Conversation turn handling" and "Complex multi-step dispatch" grid rows from the spec. Both require runtime prompt classification, which violates the convention-not-reason axiom by re-introducing judgment in a different process. They are the rows the spec author flagged as suspicious. They should be cut, not debated.
- "Punishment" framing. A violations table the developer sees once a week is not punishment; it is a metric. Frame it as one.

#### Why This Is The Right Call

The convention-not-reason axiom says routing must be deterministic lookup, not per-call judgment. Spec A relocates judgment to a Node process. Spec B relocates *some* judgment to a hook regex. Spec C accepts the violations and reports them. **D moves the judgment to skill-authoring time** — a human deciding once, in a YAML field, what tier a class of work runs at. That is the only place judgment belongs: in the convention itself, decided slowly, by a human, with the convention then enforced by mechanical lookup at every runtime.

The five violations from this session are not preventable by hooks because they happened inside Opus's reasoning, not at tool call time. The architectural answer is to remove Opus from the dispatch role entirely: skills declare their op class, commands dispatch to the declared tier, Opus's job shrinks to "pick the right skill." That is a much smaller drift surface and one we can audit with a static linter (`pipeline-lint-agents.js` already exists — extend it).

Build small, measure, then decide whether the daemon is justified. Right now it is not.
