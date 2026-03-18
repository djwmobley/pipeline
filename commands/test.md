---
allowed-tools: Bash(*), Read(*), Glob(*)
description: Run the project test suite and produce a structured pass/fail report
---

## Pipeline Test

Run the test suite and produce a structured report.

### Step 0 — Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `commands.test_verbose` (preferred) or `commands.test` (fallback)

If no config file exists, detect the test runner from project files (check in order, use first match):
1. `package.json` with `vitest` in devDependencies → `npx vitest run --reporter=verbose`
2. `package.json` with `jest` in devDependencies → `npx jest --verbose`
3. `package.json` exists (neither found) → try `npx vitest run --reporter=verbose`, fall back to `npx jest --verbose` if the command fails with "command not found" or "module not found" errors (not if tests simply fail)
4. `Cargo.toml` exists → `cargo test`
5. `go.mod` exists → `go test -v ./...`
6. `pyproject.toml` or `requirements.txt` exists → `pytest -v`

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
