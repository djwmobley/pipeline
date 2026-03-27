# Troubleshooting

Common issues when installing and running the Pipeline plugin.

---

## Plugin commands don't appear (typing `/pipe` shows nothing)

**Symptoms:** `/pipeline:*` commands are missing from autocomplete.

**Cause:** The plugin cache is stale, the plugin is disabled, or the plugin was never installed.

### Check 1: Is the plugin installed?

```bash
# Look for pipeline@pipeline in the registry
cat ~/.claude/plugins/installed_plugins.json | grep -A5 "pipeline@pipeline"
```

If missing, install it:

```bash
claude plugin install .
```

### Check 2: Is the plugin enabled?

```bash
# Check project-level settings
cat .claude/settings.json
```

You should see:

```json
{
  "enabledPlugins": {
    "pipeline@pipeline": true
  }
}
```

If it shows `false`, edit the file to set it to `true`, or run the sync hook (see below).

### Check 3: Is the cache stale?

The sync hook compares **git commit SHAs**, not version strings. Check the stored SHA against the current HEAD:

```bash
# Check what SHA the cache was built from
cat ~/.claude/plugins/installed_plugins.json | grep -A2 '"gitCommitSha"'

# Compare to the current HEAD
git rev-parse HEAD
```

If they differ, the cache is stale. The sync hook (below) fixes this automatically on the next session start. To force a manual sync:

```bash
node hooks/sync-cache.mjs
```

### Check 4: Does the cached plugin.json have a `commands` field?

```bash
# Find the cache path
CACHE=$(node -e "const r=JSON.parse(require('fs').readFileSync(require('path').join(process.env.HOME||process.env.USERPROFILE,'.claude','plugins','installed_plugins.json'),'utf8')); console.log(r.plugins['pipeline@pipeline']?.[0]?.installPath||'NOT FOUND')")
cat "$CACHE/.claude-plugin/plugin.json"
```

The `plugin.json` must contain `"commands": "./commands/"`. If it doesn't, the cache was built from an old version. Run the sync hook to fix.

### After fixing

Start a new Claude Code session. The plugin loads at session start — changes to the cache or settings don't take effect mid-session.

---

## Cache is stuck on an old version

**Symptoms:** The cached version (e.g., `0.1.0`) doesn't match `marketplace.json` (e.g., `0.2.0-alpha`). New commands or skills are missing.

**Cause:** Claude Code's plugin cache is a snapshot taken at install time. It doesn't auto-refresh when source files change. The cache directory is keyed by version string, so changing the version in `marketplace.json` leaves the old directory behind.

**Fix:**

The Pipeline plugin includes a `SessionStart` hook (`hooks/sync-cache.mjs`) that automatically syncs the cache from source on every session start. The hook compares committed SHAs — uncommitted changes are not detected. Commit your changes first, then the next session start will sync automatically.

If the hook is already in the cache, it runs automatically. If not (because the cache is from before the hook existed):

```bash
# Manual sync — run from the pipeline repo root
node hooks/sync-cache.mjs
```

This will:
1. Compare the current git HEAD SHA to the cached SHA
2. Delete the stale cache directory
3. Copy current source files to a new cache directory matching the current version
4. Sync files to the marketplace directory (where Claude Code reads commands from)
5. Update `installed_plugins.json` with the new path, version, and SHA
6. Enable the plugin if it was disabled

---

## How the auto-sync hook works

The `hooks/sync-cache.mjs` script runs on `SessionStart` (startup and resume events). It:

1. Reads `installed_plugins.json` to find the `pipeline@pipeline` entry
2. Checks if the current working directory matches the plugin's `projectPath`
3. Compares `git rev-parse HEAD` against the stored `gitCommitSha`
4. If they differ, deletes the old cache and copies these items from source:
   - `.claude-plugin/`, `commands/`, `hooks/`, `rules/`, `scripts/`, `skills/`, `templates/`
   - `CLAUDE.md`, `LICENSE`, `README.md`
5. Also syncs items to the **marketplace directory** (`~/.claude/plugins/marketplaces/pipeline/`) — Claude Code reads commands from the marketplace directory, not the cache
6. Updates the registry with the new version, SHA, and install path
7. Ensures the plugin is enabled in `.claude/settings.json`

**Important:** The hook only syncs when you're working in the pipeline repo directory. When using the pipeline plugin in other projects, the cache is stable and doesn't change.

**One-session lag:** If you modify the sync hook script itself, the old cached version runs first and syncs the new version into the cache. The updated hook takes effect on the next session.

---

## Plugin was installed but nothing works

**Symptoms:** The plugin is in `installed_plugins.json` but commands, skills, and hooks don't load.

**Checklist:**

1. **New session required** — plugin changes only load on session start
2. **Plugin must be enabled** — check `.claude/settings.json` (project-level) or `~/.claude/settings.json` (global)
3. **Cache must have `plugin.json`** — verify the cache directory contains `.claude-plugin/plugin.json` with a `commands` field
4. **Commands must exist in marketplace directory** — verify `~/.claude/plugins/marketplaces/pipeline/commands/` has `.md` files (Claude Code reads commands from the marketplace directory, not the cache)

---

## "command not found: claude" when running sync

The `claude` CLI must be installed globally. The sync hook uses `node` directly and doesn't require the `claude` CLI, but plugin installation does:

```bash
npm install -g @anthropic-ai/claude-code
```

---

## Windows path issues

The sync hook uses `path.join()` and `path.resolve()` for cross-platform compatibility. If you see path-related errors:

- Ensure you're running from the repo root (not a subdirectory)
- Use forward slashes in Git Bash: `node hooks/sync-cache.mjs`
- The `USERPROFILE` environment variable must be set (standard on Windows)

---

## Nuclear option: full reinstall

If nothing else works, clear everything and start fresh:

```bash
# 1. Remove the stale cache (find the path first)
rm -rf ~/.claude/plugins/cache/pipeline/

# 2. Remove the registry entry
# Edit ~/.claude/plugins/installed_plugins.json and delete the "pipeline@pipeline" key

# 3. Reinstall
claude plugin install .

# 4. Enable
# Edit .claude/settings.json: "pipeline@pipeline": true

# 5. Start a new session
```
