# Design Debate Verdict: Convention-not-reason model routing — daemon, hooks, telemetry

**Date:** 2026-04-25
**Spec:** `docs/specs/2026-04-25-routing-daemon-spec.md`
**Disposition:** proceed-with-constraints

## Points of Agreement

- The convention-not-reason axiom is correct: Opus's runtime routing judgment is an observed (not hypothetical) failure mode requiring architectural removal.
- The daemon + grid + hook architecture is correct in principle (analogous to AWS Step Functions / Celery routing — caller names operation, router consults static registry).
- The two flagged grid rows (`Conversation turn handling`, `Complex multi-step dispatch`) cannot be daemon-routed without prompt content classification, which is an unsolved judgment problem.
- v1 scope must be narrower than the full 12-row grid; focus on documented violations, defer aspirational rows.
- No GDPR / PCI-DSS / WCAG compliance constraints apply (developer tooling, no PII, no payments, no public UI). OSS licensing is permissive (qwen2.5 Apache 2.0, Ollama MIT).
- Ollama failure modes (model down, saturation under concurrent load, model-name renames) are unaddressed in the current spec.

## Contested Points

### CP1 — Should the `routing_violations` table + weekly aggregation be v1 or v2?
- **Advocate:** v1 — the feedback loop is what tightens the grid; surfacing systematic gaps is a load-bearing part of the design.
- **Skeptic:** v2 — "audit theater" without enforcement; defer the table and aggregation, ship the hook alone.
- **Practitioner:** Compromise — table created on init (cheap); weekly aggregation deferred (premature optimization).

### CP2 — Daemon escalation logic — does the daemon decide when to escalate to Sonnet?
- **Advocate:** Re-introduces reasoning at a lower tier than Opus; net improvement but imperfect; deterministic escalation signal preferred.
- **Skeptic:** Same problem relocated; the daemon becomes the new Opus making per-call routing decisions inside a Node process with no audit visibility.
- **Practitioner:** Cut the rows requiring this judgment entirely (Conversation turn, Complex dispatch); v1 daemon only takes deterministic-routing op-types.

### CP3 — PreToolUse hook detection — is regex on Bash args sufficient?
- **Advocate:** High-confidence cases (SQL keywords + `psql` / `db.js` patterns) work; semantic detection is a deferred gap.
- **Skeptic:** Design flaw — `cat` containing "INSERT" produces false-positives; heredocs hide SQL; FP/FN unavoidable.
- **Practitioner:** Narrow regex on Bash args (not prompt content) is sufficient for v1; full coverage is v2.

### CP4 — Should `mcp__router__embed` belong in the routing grid?
- **Skeptic:** No — embedding is persistence, not routing dispatch; conflates concerns; already exists in `scripts/pipeline-embed.js`.
- **Advocate, Practitioner:** Silent on this specifically; Practitioner's v1 scope omits it implicitly.

### CP5 — Architectural enforcement (daemon + hook) vs. behavioral enforcement (skill checklist + PostToolUse log)
- **Skeptic:** Static checklist enforced at skill level + flat-file log + weekly script ships in 1 session vs. 4–6 sessions for the daemon; tradeoff is real-time blocking.
- **Advocate:** Behavioral correction (CLAUDE.md instructions) has already been tried in this very session and failed. The next reminder will not succeed where the last several did not.
- **Practitioner:** Build is necessary — no off-the-shelf tool for convention-enforced LLM routing in the Claude Code plugin context.

## Invalidated Assumptions

- **Assumption:** A single PreToolUse hook can deterministically map Bash args to operation types via regex.
  **Invalidated by:** Skeptic's `cat | grep INSERT` example and heredocs containing keywords. False-positives and false-negatives are unavoidable; v1 must accept narrow detection scope.

- **Assumption:** The daemon eliminates routing judgment entirely.
  **Invalidated by:** The "escalate to Sonnet if judgment is needed" clause inside the daemon — the same routing-by-reason problem at a lower layer, just hidden in Node.js. Resolution requires explicit caller-supplied escalation flags rather than inferred prompt-content signals.

- **Assumption:** All 12 grid rows are daemon-enforceable.
  **Invalidated by:** "Conversation turn handling" and "Complex multi-step dispatch" are Agent-tool calls, not daemon-routed; their detection requires prompt classification, which is an unsolved judgment problem.

- **Assumption:** Building the daemon is cheaper than the violations it prevents in the near term.
  **Partially invalidated by:** Skeptic's cost analysis (4–6 Sonnet sessions to build the daemon, hook, and detection rules); Practitioner counters that the build is a platform investment with longer payback horizon, not a session-scope spend.

## Risk Register

| Risk | Raised By | Likelihood | Required Mitigation |
|------|-----------|------------|---------------------|
| PreToolUse hook regex produces false-positives that block legitimate Bash | Advocate, Skeptic | HIGH | Narrow detection to high-confidence cases (e.g., `psql`, `node scripts/pipeline-db.js`); allowlist heredocs and quoted strings; explicit denylist over implicit detection |
| Daemon serializes on Ollama for 32B model under concurrent subagent load | Skeptic | MEDIUM | Specify queue + timeout; document concurrency limits; consider model-specific worker pools or graceful fallback to smaller model |
| Daemon escalation logic re-introduces routing judgment in Node.js layer | Advocate, Skeptic | HIGH | Replace inferred-from-prompt escalation with explicit caller-supplied flag (e.g., `mcp__router__draft_short escalate=judgment`) |
| Three update surfaces (hook rules, daemon op-types, grid YAML) diverge silently | Skeptic | MEDIUM | Generate hook detection rules from grid YAML at session start; single source-of-truth pipeline; CI validation that hook ↔ grid stay in sync |
| Ollama unavailable causes hard fail or silent escalation to higher tier | Advocate | MEDIUM | Specify failure policy: hard fail with clear message; explicitly forbid silent escalation to Haiku/Sonnet on local-model unavailability |
| Building daemon costs more than near-term violations prevent | Skeptic | LOW | Ship narrow v1 (Practitioner's 4-tool scope); treat as platform investment with longer payback horizon |
| Detection of judgment-vs-mechanical from prompt content is unsolved | Advocate, Skeptic, Practitioner | HIGH | Defer all rows requiring prompt-content classification (`Conversation turn handling`, `Complex multi-step dispatch`) to v2 |
| `mcp__router__embed` row conflates routing with persistence | Skeptic | LOW | Remove from routing grid; embedding stays in `scripts/pipeline-embed.js` |

## Position Papers

### Advocate

### Strengths

**1. The enforcement architecture solves a genuine, documented failure mode.**

The spec is explicit: Opus deviated from tiering conventions *in the same session* that produced this spec. That is not a hypothetical risk — it is observed behavior. The design's response is architectural enforcement (PreToolUse hook + daemon + violations table), not a reminder or a style guide entry. This is the correct choice because AI reasoning at execution time IS drift (per the convention-not-reason axiom): any system that relies on the orchestrator to correctly self-police tier selection is a system that will fail at the rate the orchestrator misjudges. The hook removes that judgment surface entirely. The alternative — better prompting, stronger CLAUDE.md instructions, more reminders — has already been tried and failed. The spec says so. Defending that alternative would require explaining why the next reminder will succeed where the last several did not.

**2. The routing grid as single source of truth is architecturally sound.**

Storing the grid in `.claude/pipeline.yml` under a `routing:` key and making the daemon and hook both consult it means there is exactly one place to update when a tier assignment changes. This is a standard configuration-driven dispatch pattern (cf. nginx upstream blocks, AWS EventBridge rules, feature flag systems). The alternative — encoding routing logic in the hook script itself, or in the daemon, or in the orchestrator's context window — produces three divergence points. With a single YAML grid, a project can override one row without touching the enforcement infrastructure. That extensibility is not gold-plating; it is what makes this reusable across projects via `/pipeline:init`.

**3. Daemon-mediated tool invocation enforces tier isolation without per-call judgment.**

The `mcp__router__*` tool family means the calling model (Opus or otherwise) never decides which executor runs. The daemon consults the grid and dispatches. This eliminates the class of error where Opus correctly identifies the operation type but then reasons itself into a higher tier ("this SQL insert is nuanced, so I'll handle it directly"). The daemon does not reason; it looks up and dispatches. The escalation path — daemon escalates to Sonnet via Agent when a judgment signal is detected — is the one place where reasoning re-enters, and it re-enters at a lower tier than Opus, which is an improvement even if imperfect.

**4. The violations table creates a feedback loop that tightens the grid over time.**

Logging every blocked and attempted bypass to `routing_violations` and surfacing deviations in `/pipeline:finish` ship summaries converts enforcement failures into data. A weekly aggregation that surfaces systematic gaps is not punitive theater — it is the mechanism by which the grid learns. Without this, the hook is a hard gate with no signal about where the grid is incomplete. With it, repeated violations against the same operation type flag that the grid needs a new row.

### Scope Defense

**"This could be simpler."** A simpler version — stronger CLAUDE.md instructions, better prompts — has been tried. The spec documents the failures. The components that might appear over-engineered (daemon, hook, violations table) are each necessary for a different failure mode: the daemon prevents self-routing at dispatch time; the hook prevents bypass via direct Bash/Agent calls; the violations table prevents silent drift over sessions. Remove any one and the corresponding failure mode returns.

**"This is too ambitious."** The four deliverables (daemon script, hook template, grid schema, violations table) are independent and can ship incrementally. The daemon can be stubbed with pass-through behavior and hardened per operation type over time. The hook can start with a short list of high-value intercepts (SQL, large file reads, Sonnet dispatch for mechanical tasks) before covering the full grid. The violations table is a CREATE TABLE + an INSERT in the hook exit path — not complex. None of these require simultaneous completion to deliver value.

**Genuine scope concern:** The two flagged rows — "Conversation turn handling → Haiku" and "Complex multi-step dispatch → Sonnet via Agent" — are not daemon-routed operations; they describe how the *calling* model should invoke Agent tool calls. These rows belong in the grid as documentation, but the daemon cannot intercept them the same way it intercepts SQL or file writes, because they are Agent-tool dispatches that require the hook to inspect `model=` args and prompt content at a semantic level. That is a harder detection problem. The spec surfaces this without resolving it; the Practitioner should flag the implementation gap.

### Implementation Feasibility

The daemon is a standard MCP server. Claude Code's MCP protocol is documented and Pipeline already runs scripts via `node scripts/*.js`. Adding `scripts/lib/router-daemon.js` as an MCP server with one tool per operation family is a straightforward extension of existing patterns in the codebase.

The PreToolUse hook is a JSON entry in `.claude/settings.json` pointing to a script that receives tool name and args via stdin. This is a supported Claude Code hook type (the codebase already uses hooks per the CLAUDE.md). The detection logic for high-confidence cases (Bash tool + SQL keywords, Agent tool + `model=sonnet` + mechanical prompt) is implementable with regex plus a small classifier. The hard case — detecting *judgment vs. mechanical* from prompt content — requires either a heuristic (keyword list) or a local model call, and the spec does not resolve this. That is a genuine implementation gap the Skeptic should pursue.

Realistic effort: the daemon + grid schema + violations table is a 2-3 day implementation. The hook with high-confidence intercepts (SQL, glob, grep, short-prose) is another 1-2 days. Full coverage of all 12 grid rows, including semantic prompt inspection, is a separate workstream that can follow the initial ship.

### Compliance Strengths

No GDPR, PCI-DSS, or WCAG requirements are in scope for this design. The design does not handle personal data, payment data, or UI accessibility. Licensing: the design routes work to qwen2.5:14b and qwen2.5-coder:32b (local Ollama models). No external API data-sharing obligations arise from local model dispatch; this is a compliance *improvement* over sending all operations to Anthropic-hosted models. If the project later handles user data in SQL operations routed through the daemon, the daemon's centralized dispatch point would be an appropriate place to insert a data-classification check — but that is future scope, not present requirement.

### Risks Accepted

**The hook's detection logic will have gaps.** A PreToolUse hook that inspects Bash args for SQL keywords will miss obfuscated or parameterized invocations. A hook that inspects Agent prompts for "judgment" signals will misclassify edge cases in both directions (false blocks, false passes). The violations table mitigates this by making misses visible over time, but early sessions will have both undetected bypasses and spurious blocks. This is acceptable if the hook starts narrow (SQL, large reads) and widens as the grid matures.

**The daemon adds a latency layer for every gated operation.** Every SQL call, every short-prose draft, every embedding now routes through an MCP round-trip before dispatching to the actual executor. For bulk operations (51-field classification, batch embeddings), this is negligible. For single-row SQL reads in a hot path, the overhead is real. The spec does not address latency budgets.

**The design assumes Ollama is always available.** The grid routes short prose and bulk classification to qwen2.5:14b local. If Ollama is down or the model is not loaded, the daemon has no fallback specified. A silent escalation to Haiku on local-model failure would defeat the enforcement purpose; a hard failure would block work. The spec is silent on this failure mode.

**Convention-not-reason applied to the daemon itself.** The daemon's escalation logic — "if the prompt signals a judgment task, escalate to Sonnet" — reintroduces a reasoning step inside the daemon. This is the same problem the design is trying to solve, just relocated. A deterministic escalation signal (explicit flag in the tool call args, not inferred from prompt content) would be more consistent with the axiom the design enforces everywhere else.

### Skeptic

### Scope Concerns

**The spec ships three orthogonal systems as one "LARGE" change.**

The routing grid, the MCP daemon, and the PreToolUse enforcement hook are independently deployable. Shipping them together means a bug in the daemon blocks the enforcement layer, and a bug in the hook blocks validation of the grid. The spec treats them as a single unit but gives no rollback path when one layer is broken and the others are theoretically correct.

**The `routing_violations` table and weekly aggregation are v2 features disguised as v1 requirements.** The Postgres table, the `/pipeline:finish` "Routing Deviations" section, and the "systematic gap" aggregation are observability additions that add surface area without contributing to enforcement. The hook either blocks a call or it does not. The violation record is audit theater in v1. Defer the table and ship the hook alone.

**The `mcp__router__embed` row in the grid is a scope leak.** Embedding vectorization is not routing enforcement — it is a persistence utility that already exists in `scripts/pipeline-embed.js`. Adding it to the routing grid conflates operation dispatch with the embedding pipeline. This row does no work against the stated goal (removing Opus's routing judgment) and will require the daemon to understand index naming conventions that belong in a separate layer.

### Feasibility Attacks

**Attack 1 — The PreToolUse hook cannot distinguish intent from invocation. (Design flaw.)**

The hook is described as mapping "Bash tool, SQL operation" to `daemon_sql`. But Bash is a general-purpose executor. A `cat` command containing the substring `INSERT` will pattern-match as SQL. A Bash heredoc constructing a commit message containing a SQL keyword will false-positive. The spec hand-waves the detection rule as "SQL operation" without specifying the parser. Any regex-based detector will produce both false positives (blocking legitimate Bash) and false negatives (SQL disguised in a heredoc variable). The spec does not acknowledge this ambiguity at all.

**Attack 2 — The daemon is a single-process bottleneck with no concurrency specification. (Integration risk.)**

`router-daemon.js` is described as one file serving all op-type families. When Sonnet subagents run in parallel (the spec explicitly supports `Agent model=sonnet` dispatches), two concurrent calls to `mcp__router__draft_code` will hit the same Ollama endpoint for qwen2.5-coder:32b. Ollama with a 32B model serializes inference. The spec makes no mention of queuing, timeout handling, or what happens when the local model is saturated. A Sonnet subagent waiting 90 seconds for a code draft because another subagent locked Ollama is not a config issue — it is a design gap in the concurrency model.

**Attack 3 — The "escalation to Sonnet via Agent if judgment is needed" inside the daemon re-introduces routing judgment. (Design flaw.)**

The spec states the daemon "escalates to Sonnet via Agent if judgment is needed." The daemon must now contain the judgment logic to decide when escalation is warranted. This is the same problem one level down. The daemon becomes the new Opus, making per-call routing decisions — except now those decisions are hidden inside a Node.js process with no visibility, no logging in v1, and no mechanism for the user to audit them. The spec has not eliminated Opus's routing judgment; it has relocated it.

**Attack 4 — The two flagged mis-tierings in the grid are not minor. (Integration risk.)**

The "Conversation turn handling → Haiku" row and the "Complex multi-step dispatch → Sonnet via Agent" row are both described as grid entries, but neither routes through the daemon — they route directly via the `Agent` tool. If the hook denies direct `Agent` calls for restricted op-types, these rows self-contradict: they are grid entries that bypass the daemon by design. The spec noticed this, flagged it, and deferred resolution to the debate panel. That is not a debate question — it is an underspecified architecture.

### Token / Cost Analysis

**Building the daemon costs more tokens than the routing violations it prevents, before the grid stabilizes.**

The daemon requires: (a) designing the MCP tool schema for 10-12 op families, (b) writing `router-daemon.js` with Ollama dispatch for each, (c) writing and debugging the PreToolUse hook parser, (d) testing false-positive and false-negative detection across representative Bash invocations, (e) wiring the Postgres violations table. This is a 4-6 Sonnet-session build. The session history shows the actual mis-tierings: Opus read a 520-line file and dispatched Sonnet for 51 fields of classification. Both of those are preventable today with a two-line grid enforcement policy in `CLAUDE.md` and a `Read limit=` convention. The architectural solution costs more to build than the behavioral correction saves in the near term.

**Ongoing debugging will be painful.** When a Sonnet subagent is blocked by the hook for a false-positive SQL detection in a heredoc, the developer must: inspect the hook log (if it exists in v1), identify which Bash call triggered the rule, determine whether the detection logic is wrong or the call should have been routed differently, and then modify either the hook regex or the grid. This loop will happen frequently during the stabilization period because the detection rules are under-specified. Each loop is a Sonnet dispatch to diagnose a routing enforcement failure — defeating the purpose.

### Maintenance Burden

The hook's detection rules must be updated every time a new Bash invocation pattern is introduced. The daemon's op-type families must be updated when new operation classes emerge. The grid schema in `pipeline.yml` must stay in sync with both. These are three separate update surfaces that can diverge silently — a new SQL pattern that bypasses the hook will never appear in `routing_violations` because it was never blocked.

The daemon's Ollama integration is coupled to model names (`qwen2.5:14b`, `qwen2.5-coder:32b`). When models are updated or renamed, all daemon dispatch paths break simultaneously. The spec does not specify how model names are configured or updated.

A future maintainer needs to understand: the MCP protocol, the PreToolUse hook contract, the Ollama API, the `pipeline.yml` grid schema, and the Postgres violations schema — before they can debug a routing failure. That is a high context floor for what is fundamentally a dispatch table.

### Simpler Alternative

**A static operation checklist enforced at the skill level, not the tool level.**

Keep the routing grid in `pipeline.yml` as documentation. Enforce it by adding a mandatory preamble to every skill's SKILL.md: a checklist of operation types the skill performs, with the required executor for each. The `/pipeline:review` step (already in the pipeline) validates that skill invocations match the grid before the session proceeds. Add one `PostToolUse` hook that logs tool name and model to a flat file — no Postgres, no daemon, no MCP. Weekly, a script reads the log and reports tier violations.

What you cut: the MCP daemon, the PreToolUse detection parser, the `routing_violations` table, and the daemon escalation logic.

What you keep: the routing grid as a spec, the violation log as a flat file, and the review step as the enforcement gate.

The tradeoff: this approach does not block violations in real time — it surfaces them at review. The user's stated goal is "remove Opus's runtime judgment entirely." A checklist enforced at review does not prevent drift within a session. If real-time enforcement is non-negotiable, no simpler alternative exists that achieves it — the daemon and hook are the minimum viable architecture. But if the actual goal is "make violations visible and costly," the simpler alternative is sufficient and ships in one session.

### Practitioner

### Real-World Context

Production systems that enforce execution-tier discipline exist, and they look nothing like this spec. The closest analogs are message routing layers in microservice architectures — AWS Step Functions routing to Lambda vs. Fargate vs. ECS based on payload characteristics, or Celery/Dramatiq routing tasks to worker pools by queue tag. The pattern that works in those systems is dead simple: **the caller does not pick the executor; the caller names the operation, and a router consults a static registry.**

What this spec proposes is that pattern applied to LLM orchestration, and the instinct is correct. Where mature systems diverge from this spec is in how the registry is enforced. In Celery, the routing is enforced at enqueue time — the worker pool receiving the task cannot be overridden by the task itself. That is a hard constraint baked into the transport layer. The PreToolUse hook approach in this spec is the closest analog in the Claude Code runtime, and it is the right lever. The LangChain/LlamaIndex ecosystem has attempted soft routing via prompt engineering; every production team that shipped on that foundation eventually replaced it with hard routing at the infrastructure layer for exactly the reason this spec names: drift.

The spec's daemon-mediated MCP architecture aligns with how Anthropic's own tool-use pattern is meant to work — tools as typed operation contracts, not raw Bash escape hatches. Routing SQL through `mcp__router__sql` rather than Bash is the correct pattern. The spec is well-aligned with established practice here.

### Existing Alternatives

No off-the-shelf solution exists for convention-enforced LLM routing within a Claude Code plugin context. The broader LLM orchestration market (LangGraph, CrewAI, AutoGen) addresses multi-agent routing but at the framework level — they require replacing Claude Code's native Agent tool with their own runtime, which is a non-starter for a plugin that piggybacks on Claude Code.

The spec's approach — MCP server as router daemon, grid in YAML, hooks as enforcement — is a build. There is no buy option that fits this runtime. The gap the design fills is real: no existing tool enforces tier routing within a Claude Code PreToolUse hook.

### Compliance and Regulatory Reality

No compliance constraints apply. This is a developer tooling plugin with no user PII, no payment data, no public-facing UI, and no EU user data in scope. OSS licensing is the only consideration: the spec uses qwen2.5 models (Apache 2.0 license) and Ollama (MIT). Both are permissive. No regulatory constraints affect scope decisions here.

### What Users Actually Need

The user who hits this feature daily is the Opus orchestrator trying not to violate its own budget. That user needs two things: first, that violations are blocked before they cause spend (hook enforcement), and second, that the grid is easy to read and adjust when a new operation type appears. The routing violations table is valuable for surfacing systematic gaps — that is genuinely useful on a weekly review cadence, not a daily one.

What users do NOT need in v1: the full twelve-row grid. Half those rows cover edge cases (metadata-only reads, Ollama-mediated embeddings) that the orchestrator has never hit in a session that caused a complaint. Shipping a six-row grid that covers the four documented violations (file reads, SQL, short prose, bulk classification) is what delivers value. The completionist grid ships as `# TODO` rows in the YAML template; the daemon routes unknown operations to a logged passthrough rather than crashing.

The spec's "Conversation turn handling → Haiku via Agent tool" row is aspirational — there is no hook-detectable signal that distinguishes a "conversation turn" Agent call from a "complex dispatch" Agent call at the PreToolUse layer without inspecting prompt content, which requires judgment. That row belongs in v2 when prompt classification is solved.

### Practical Scope Recommendation

**In-scope (v1):**
- `scripts/lib/router-daemon.js` with four tool endpoints: `mcp__router__sql`, `mcp__router__classify`, `mcp__router__draft_short`, `mcp__router__draft_code`. These map directly to the four documented violations.
- PreToolUse hook that blocks direct Bash SQL and direct large-file Bash reads. Narrow detection surface — regex on Bash args, not prompt content inspection.
- `routing_violations` table, created on `/pipeline:init`.
- Six-row grid in `.claude/pipeline.yml` template covering the four endpoints plus no-LLM file ops.

**Defer (v2+):**
- "Conversation turn handling" and "Complex multi-step dispatch" grid rows. The detection rule for these requires prompt content classification — that is a judgment layer inside the prevention layer, which is recursive and unsolved.
- Weekly aggregation reporting on violations. Valuable, but the violations table already exists; the aggregation query is a one-liner when the user wants it.
- Full grid completeness (12 rows). Extend the grid as violations surface new patterns.

**Cut entirely:**
- The `permissions.deny` template entries in `.claude-plugin/settings.json.template` for anything beyond SQL and Bash. Broad `permissions.deny` on Agent calls will break legitimate Sonnet dispatches. The hook is the enforcement layer; `permissions.deny` is a blunt instrument that should not gate judgment-prose operations.

The core value is delivered by four daemon tools, one hook, and one violations table. Everything else is polish on top of a foundation that does not yet exist.
