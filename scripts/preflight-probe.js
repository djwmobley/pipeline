#!/usr/bin/env node
// Orientation preflight probe — emits the 6-point mechanical context as JSON on
// stdout. Invoked by skills/orientation/SKILL.md Step 1. Interpretation
// (Steps 2-3 of the orientation skill — prose output template, intent
// comparison, base-branch and worktree guards) remains in prose and is
// performed by the LLM on this JSON output.
//
// Exit codes: 0 on success; 1 on any probe failure, with a one-line stderr
// message naming the step that failed.

const { execFileSync } = require('child_process');
const path = require('path');

const cwd = process.cwd();

function git(args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function step(name, fn) {
  try {
    return fn();
  } catch (e) {
    process.stderr.write(`preflight-probe: step "${name}" failed: ${e.message.split('\n')[0]}\n`);
    process.exit(1);
  }
}

const repo_root = step('repo_root', () => git(['rev-parse', '--show-toplevel']));
const branch = step('branch', () => git(['branch', '--show-current']));
const head = step('head', () => git(['rev-parse', '--short', 'HEAD']));

// Worktree detector: the only authoritative git signal for a linked worktree is
// that --git-dir and --git-common-dir resolve to different paths. Substring
// matching a path for "worktrees" gives false positives when the repo itself
// lives under a directory named worktrees/.
const gitDir = step('git_dir', () => git(['rev-parse', '--git-dir']));
const gitCommonDir = step('git_common_dir', () => git(['rev-parse', '--git-common-dir']));
const worktree = path.resolve(cwd, gitDir) === path.resolve(cwd, gitCommonDir) ? 'MAIN' : 'WORKTREE';

const statusOut = step('dirty_count', () =>
  execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })
);
const dirty_count = statusOut.trim() === '' ? 0 : statusOut.trim().split('\n').length;

const output = { cwd, repo_root, branch, head, worktree, dirty_count };
process.stdout.write(JSON.stringify(output, null, 2) + '\n');
