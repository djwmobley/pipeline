# Pipeline Security Agents — Overview

This document explains what Pipeline's security agents do, why they exist, and how to use them. It is written for product managers, engineering leads, and anyone who needs to understand Pipeline's security capabilities without reading the underlying code.

---

## 1. Why Pipeline Has Security Agents

Software has vulnerabilities — flaws that let attackers do things they shouldn't. Some are obvious (a hardcoded password in the code). Some are subtle (three minor issues that, chained together, allow an attacker to take over user accounts).

Pipeline's security agents find these before your users do. Two agents, two jobs:

- **Red team** plays the attacker. It probes your code from 12 different attack angles, looking for ways in.
- **Purple team** plays the defender. After you fix what red team found, purple team verifies the fixes actually work.

---

## 2. How the Security Loop Works

```
1. Red Team Assessment (/pipeline:redteam)
   → 12 specialist agents scan your code for vulnerabilities
   → Produces a findings report with severity ratings

2. You Review the Findings
   → Mark false positives (things that look like bugs but aren't)
   → Decide what to fix now vs. accept as known risk

3. Remediation (/pipeline:remediate)
   → Fixes each finding one at a time
   → One commit per fix, tests run, code reviewed
   → Creates/updates GitHub issues for tracking

4. Purple Team Verification (/pipeline:purpleteam)
   → Verifies each fix actually closed the attack vector
   → Checks that fixing one thing didn't break another
   → Scans dependencies for known vulnerabilities
   → Extracts defensive patterns for future development
   → Updates GitHub issues with verification evidence
```

Each step is a separate command. You control when to move to the next step. This is deliberate — you need to review findings before fixes start, and you need to review fixes before verification.

---

## 3. What Each Agent Does

### Red Team — The Attacker

Red team thinks like someone trying to break into your application. It deploys up to 12 specialists, each expert in a different type of attack:

| Specialist | What It Looks For |
|---|---|
| Injection | SQL injection, command injection, template injection |
| Authentication | Weak passwords, session hijacking, broken login flows |
| XSS | Scripts that run in users' browsers without permission |
| CSRF | Tricking users into performing actions they didn't intend |
| Cryptography | Weak encryption, hardcoded keys, insecure random numbers |
| Configuration | Debug mode left on, verbose error messages, missing security headers |
| Dependencies | Runs live vulnerability audit (`npm audit`, `pip audit`, etc.), reads SBOM artifact from recon, checks for known CVEs, lockfile integrity, typosquatting, abandoned packages |
| Access Control | Users accessing data they shouldn't, privilege escalation |
| Rate Limiting | No limits on login attempts, denial-of-service vectors |
| Data Exposure | Sensitive data in logs, URLs, or API responses |
| File Safety | Path traversal, unrestricted uploads, unsafe temp files |
| Transport | Missing HTTPS, weak TLS, certificate validation issues |

Not every project gets all 12. Pipeline selects specialists based on your project type — a command-line tool doesn't need XSS checks.

Before specialists launch, the recon agent also generates a **Software Bill of Materials (SBOM)** — a structured inventory of every dependency in your project (direct, dev, and transitive). This CycloneDX 1.6 JSON file is saved to `docs/findings/` and used by the DEPS specialist as its primary package list. See [SBOM Generation](#8-sbom-generation) below.

After the specialists finish, a lead analyst synthesizes the results: deduplicates, identifies exploit chains (multi-step attacks), and produces a prioritized report.

### Purple Team — The Defender

Purple team runs after you've fixed the red team findings. It has three jobs:

1. **Verify each fix** — For every finding that was fixed, a defense specialist reads the fix and replays the original attack scenario against the current code. Did the specific exploitation scenario actually stop working? Not "did the code change" — did the *attack* fail?

2. **Verify exploit chains are broken** — Red team may have found that three minor issues chain together into a serious attack. Purple team checks whether the chain is broken. Sometimes fixing one link isn't enough if alternative paths exist.

3. **Extract defensive patterns** — When a fix is verified, the defensive pattern (for example, "always parameterize database queries") gets saved to your project's knowledge base. Future code can reference these patterns.

Plus: purple team runs a **dependency audit** using your package manager's built-in vulnerability scanner (like `npm audit`). This catches known vulnerabilities in third-party packages that may have been published since the red team ran.

---

## 4. Dependency Auditing

Your project uses open-source packages. Those packages sometimes have known security vulnerabilities — published in public databases that anyone can check.

Pipeline runs your package manager's built-in audit tool to check for these. This is the same thing commercial tools like Snyk do, but using free, public databases:

| Package Manager | Audit Tool | Database |
|---|---|---|
| npm | `npm audit` | GitHub Advisory Database |
| yarn | `yarn audit` | GitHub Advisory Database |
| pnpm | `pnpm audit` | GitHub Advisory Database |
| pip | `pip audit` | Open Source Vulnerabilities (OSV) |
| cargo | `cargo audit` | RustSec Advisory Database |
| go | `govulncheck` | Go Vulnerability Database |

No accounts, no API keys, no cost. The audit command is configured in your project's `pipeline.yml` under `commands.security_audit`.

---

## 5. What the Reports Look Like

Every security assessment produces files in `docs/findings/`:

- `redteam-2025-03-15.md` — What was found
- `remediation-2025-03-16.md` — What was fixed
- `purpleteam-2025-03-17.md` — Whether the fixes worked
- `sbom-2025-03-15.cdx.json` — Complete dependency inventory (CycloneDX 1.6)

Each finding has:

- **Severity** — CRITICAL (fix immediately), HIGH (fix soon), MEDIUM (fix when possible), LOW (consider), INFO (informational)
- **Confidence** — How sure the agent is: HIGH (code verified), MEDIUM (pattern detected), LOW (inferred)
- **CWE ID** — A standard reference number from the Common Weakness Enumeration, which is a public catalog of software weaknesses. Think of it like a diagnosis code — it precisely names the type of flaw so anyone can look it up.
- **Evidence** — Specific code references, not vague assertions

Purple team adds verification verdicts:

- **VERIFIED** — The attack no longer works. Evidence provided.
- **INCOMPLETE** — Code was changed but the attack still works. Needs more work.
- **REGRESSION** — The fix introduced a new problem. Issue reopened.

---

## 6. The GitHub Issue Trail

Every finding with sufficient severity gets a GitHub issue. The issue tracks the full lifecycle:

1. **Created by remediation** — Title, description, severity, CWE reference
2. **Fix comment** — "Fixed in commit abc123. Changes: parameterized the query."
3. **Issue closed** — After fix is committed
4. **Verification comment** — Purple team adds: "VERIFIED — attack vector confirmed closed. Evidence: [specific code reference]"
5. **Or reopened** — If verification found a regression or incomplete fix

You can open any security issue and see the complete story: what was found, what was done about it, whether the fix worked, and what defensive pattern was extracted. No separate tracking needed.

---

## 8. SBOM Generation

A Software Bill of Materials (SBOM) is a complete inventory of every software component in your project — not just the packages you listed in `package.json`, but every transitive dependency those packages pull in. This matters because 80%+ of your attack surface is in transitive dependencies you never explicitly chose.

Pipeline generates an SBOM during red team recon, before specialists launch. The recon agent:

1. Reads your lockfile (`package-lock.json`, `yarn.lock`, `Cargo.lock`, `poetry.lock`, etc.) for the full resolved dependency tree
2. Reads your manifest (`package.json`, `Cargo.toml`, etc.) to classify each package as direct, dev, or transitive
3. Writes a **CycloneDX 1.6 JSON** file to `docs/findings/sbom-YYYY-MM-DD.cdx.json`

The output file contains every component with:
- **Name and version** — exact resolved version from the lockfile
- **Scope** — `required` (runtime), `excluded` (dev-only), or transitive
- **Package URL (PURL)** — standard identifier like `pkg:npm/express@4.18.2`

### How Specialists Use It

The DEPS (Dependency & Supply Chain) specialist reads the SBOM as its primary package list. Instead of re-parsing your manifest, it gets the complete inventory including transitive dependencies and cross-references it against:
- Live vulnerability audit output (`npm audit`, `pip audit`, etc.)
- Known CVE databases
- Lockfile integrity checks

### Supported Ecosystems

| Package Manager | Lockfile | PURL Format |
|----------------|----------|-------------|
| npm / yarn / pnpm / bun | `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock` | `pkg:npm/name@version` |
| pip / poetry | `poetry.lock` | `pkg:pypi/name@version` |
| cargo | `Cargo.lock` | `pkg:cargo/name@version` |
| go | `go.sum` + `go.mod` | `pkg:golang/module@version` |

### Configuration

SBOM generation is controlled by `redteam.sbom` in your `pipeline.yml`:

```yaml
redteam:
  sbom:
    enabled: true              # Set to false to skip SBOM generation
    format: "cyclonedx"        # Only CycloneDX supported currently
    output_dir: "docs/findings/"
```

If no lockfile is found, the SBOM falls back to direct dependencies only (from the manifest) and notes this limitation in the output.

---

## 9. When to Run Each Command

| Situation | Command | When |
|---|---|---|
| New feature complete | `/pipeline:redteam` | Before shipping — find what's wrong |
| After reviewing red team findings | `/pipeline:remediate --source redteam` | Fix what needs fixing |
| After remediation complete | `/pipeline:purpleteam` | Verify the fixes work |
| Pre-release check | `/pipeline:redteam` then full loop | Final security sweep |
| Dependency update | `/pipeline:purpleteam` | Check if new vulnerabilities appeared |
