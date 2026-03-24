# The Big 4 — A Framework for Building Good Software

Every agent prompt in Pipeline evaluates four dimensions: functionality, usability, performance, and security. This page explains where the framework comes from, why it works, and how Pipeline applies it.

## The Framework

The Big 4 started as a training tool for product management and engineering teams. Applied at the user story and acceptance criteria level, it asks four questions:

| Dimension | Core Question | PM's Role |
|-----------|--------------|-----------|
| **Functionality** | Does this deliver value toward the goal? Does it fit the bigger picture, or is it a feature for the sake of a feature? | Define the value target |
| **Usability** | Is this the shortest route to get there? Do the screens cause confusion or resolution? Users do not like to wait, and they do not like to think through a screen. | Advocate for the user's path |
| **Performance** | Are we meeting accepted norms for how fast a page loads or an app responds? Is the functionality or usability we designed making that impossible? | Set expectations, not solutions |
| **Security** | Is it safe? Are secrets kept secret? Are we asking users to overshare? | Prompt engineers to think about it — don't write the technical solution |

All four are from a business standpoint. It is up to the engineer to route us there. The PM tells the engineer the destination and the points to see along the way.

## The Tension

The four dimensions are not a checklist. They are in tension with each other.

- Adding a **security** confirmation step hurts **usability** — the user has to click through another dialog.
- Adding **features** hurts **performance** — more code, more data, more rendering.
- Optimizing for **speed** might mean cutting **functionality** — fewer options, simpler flows.
- Making something more **usable** (auto-filling fields, remembering preferences) can create **security** surface area.

A PM who only thinks about functionality writes a feature request. A PM who feels the tension between all four writes a story an engineer can actually build from. The job is not to maximize one dimension. It is to find the best mix.

## From PMs to Agents

The same framework applies to writing instructions for AI coding agents. When you write a prompt for an agent, you are doing the same thing a PM does when writing a user story:

- Define what value looks like (functionality)
- Think about the user's path (usability)
- Set performance expectations (performance)
- Flag security concerns (security)

The prompt is the user story. The agent is the engineer. The PM still defines the destination, not the route. Give the agent something to think about, not just something to answer.

## Where Big 4 Appears in Pipeline

Each agent role gets the right weight of Big 4 awareness for what it does:

| Agent Role | Big 4 Weight | Why |
|-----------|-------------|-----|
| **Brainstorming** (PM) | Full evaluation — all four dimensions with confidence levels, tensions surfaced for the user to decide | The PM's job is to find the best mix. This is where tradeoffs are made. |
| **Spec reviewer** | Checks that the spec addresses usability and performance alongside existing completeness/security checks | A spec that ignores two of four dimensions will produce an incomplete implementation. |
| **Visual companion** (UX) | Evaluates mockups and designs against all four before presenting | A screen that looks good but loads slowly, confuses users, or leaks data is not a good screen. |
| **Implementer** (engineer) | Lightweight — one line: flag concerns as DONE_WITH_CONCERNS, don't redesign | The implementer's job is to build the spec. If something is wrong, flag it for the reviewer. Don't redesign mid-build. |
| **Reviewer** (QA) | Full dimensional review — usability and performance findings use the same severity tiers as bugs and security issues | A review that only checks correctness misses half the picture. User-facing clarity and scalability are real problems, not suggestions. |

The weight varies because the roles are different. The PM explores tradeoffs. The engineer executes. The reviewer verifies. The framework is the same; the depth changes.

---

Back to the [README](../README.md).
