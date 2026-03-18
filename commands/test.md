---
allowed-tools: Bash(*)
description: Run the project test suite and produce a structured pass/fail report
---

## Pipeline Test

Run the test suite and produce a structured report.

### Step 0 — Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `commands.test_verbose` (preferred) or `commands.test` (fallback)

If no config file exists, use common defaults:
- If `package.json` exists: `npx vitest run --reporter=verbose` or `npx jest --verbose`
- If `Cargo.toml` exists: `cargo test`
- If `go.mod` exists: `go test -v ./...`
- If `pyproject.toml` exists: `pytest -v`

---

### Step 1 — Run tests

If the user passed a pattern argument (e.g., `/pipeline:test useAuth` or `/pipeline:test src/test/`),
run only matching tests with the pattern appended.

Otherwise run the full suite using `commands.test_verbose`.

---

### Step 2 — Report

Always use this exact structure:

```
## Test Results

✅ N passing  |  ❌ N failing  |  ⏱ Xs

### Test Suites
[list each suite with ✅ or ❌ and file path]

### Failures  (omit section entirely if 0 failures)
#### [Test name]
- File: [path]
- Error: [error type + message, one line]
- Expected: [expected value if assertion failure]
- Received: [received value if assertion failure]
- Likely cause: [one sentence diagnosis]

### Verdict
[One of: "All green ✅", "N failures — [category of failure]"]
```

If all tests pass: confirm the count, say it's green, done.
If any test fails: show the structured report, then suggest the most likely fix for each failure.
