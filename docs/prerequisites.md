# Pipeline Prerequisites

> **Alpha** — Pipeline is under active development. Content may change between releases.

## Fast Track

Already have Git and Claude Code? You're ready:

```bash
claude plugin install --scope user https://github.com/djwmobley/pipeline
```

Then open Claude Code in any project and run `/pipeline:init`. Pipeline detects your stack, generates config, and works immediately. Everything below is optional and adds capabilities — Postgres adds searchable history, Ollama adds semantic search, browser tools add UI review, etc.

**Only Git and Claude Code are required.** Read on for the full setup if you want the extras.

---

## Full Setup

Install these tools before running the pipeline. Each one takes a few minutes. Go in order — some later steps depend on earlier ones.

---

## Before You Start

Several steps below use a command called **winget** to install software. It comes pre-installed on Windows 10 and 11. To check if you have it, open a terminal and type `winget --version`. If it says "not recognized", open the **Microsoft Store**, search for **App Installer**, and install or update it.

Every step below asks you to type commands into a **terminal** (also called a command prompt). Here's how to open one on Windows:

- **Easiest way:** Press `Win` + `X`, then click **Terminal** or **Windows PowerShell**.
- **Alternative:** Press `Win`, type **PowerShell**, and hit Enter.
- **Need admin?** Press `Win`, type **PowerShell**, then right-click it and choose **Run as administrator**. Click Yes on the confirmation popup. Only a couple steps below need this.

> **Mac/Linux users:** Use Terminal (Mac) or your preferred terminal emulator. Replace `winget install` commands with your package manager (`brew install` on Mac, `apt install` on Ubuntu/Debian, etc.).

---

## 1. Git

**What it does:** Version control — tracks every change to your code so nothing is ever lost.

| | |
|---|---|
| **Install** | `winget install --id Git.Git -e --source winget` |
| **Or** | Download from [git-scm.com/download/win](https://git-scm.com/download/win) and run the installer |
| **Verify** | `git --version` |

**Admin not required.** The winget command and the standalone installer both work from a regular terminal. If using the standalone installer, accept all the defaults — they're fine.

**After install, close and reopen your terminal** so it picks up the new command. Then set your identity:

```
git config --global user.name "Your Name"
git config --global user.email "your@email.com"
```

Replace with your real name and email. These show up on your code contributions.

---

## 2. GitHub Account + CLI

**What it does:** GitHub hosts your code online and lets you collaborate. The CLI lets you log in from the terminal.

| | |
|---|---|
| **Sign up** | [github.com/signup](https://github.com/signup) — create a free account (do this first) |
| **Install** | `winget install --id GitHub.cli` |
| **Verify** | `gh --version` |

**Admin not required.** Works from a regular terminal.

**After install, close and reopen your terminal,** then log in:

```
gh auth login
```

It will ask you a few questions. Choose:
- **GitHub.com** (not Enterprise)
- **HTTPS** (not SSH)
- **Login with a web browser** — it opens a page where you paste a code

---

## 3. Node.js

**What it does:** JavaScript runtime — many pipeline tools and MCP servers depend on it.

| | |
|---|---|
| **Install** | `winget install OpenJS.NodeJS` |
| **Or** | Download the LTS version from [nodejs.org](https://nodejs.org) and run the installer |
| **Verify** | `node --version` and `npm --version` |

**Admin not required** for winget. If using the website installer (.msi), it may ask for admin — click Yes if prompted.

**Close and reopen your terminal** after install, then run the verify commands above. Both should print a version number.

---

## 4. Python

**What it does:** A programming language used by some pipeline scripts (e.g., markdown-to-Word export).

| | |
|---|---|
| **Install** | `winget install --id Python.Python.3.14` |
| **Or** | Download from [python.org/downloads](https://www.python.org/downloads/) — click the big yellow "Download" button |
| **Verify** | `python --version` |

> **Important:** If using the website installer, the very first screen has a checkbox at the bottom that says **"Add Python to PATH"**. **Check that box!** It's unchecked by default and is the #1 setup mistake. Without it, the `python` command won't work.

**Admin not required** for winget. The website installer may ask — click Yes if prompted.

**Close and reopen your terminal** after install, then type `python --version`. You should see a version number.

---

## 5. PostgreSQL

**What it does:** Local database that stores your sessions, tasks, and decisions. The pgvector extension adds semantic search so the AI can find relevant context across all your past work — this reduces hallucinations and lost context.

**Required?** Optional. Without it, pipeline uses the "files" tier — markdown-based session tracking that works but lacks search.

| | |
|---|---|
| **Install** | Download from [enterprisedb.com](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads) — Windows installer |
| **Verify** | `psql --version` |

**Needs admin.** Right-click the downloaded installer and choose **Run as administrator**. The installer asks you to create a password — **write it down!** You'll need it later. Accept all other defaults.

### Allow password-free local connections

After installing, you need to edit a config file so the pipeline scripts can connect without prompting for a password every time.

1. Find the file called `pg_hba.conf` — it's usually at:
   `C:\Program Files\PostgreSQL\18\data\pg_hba.conf`

2. Open it in Notepad **as administrator** (right-click Notepad > "Run as administrator" > File > Open > navigate to the file). You may need to change the file filter from "Text Documents" to "All Files" to see it.

3. Near the bottom, find the lines that look like this:
   ```
   host    all    all    127.0.0.1/32    scram-sha-256
   host    all    all    ::1/128         scram-sha-256
   ```

4. Change `scram-sha-256` to `trust` on both lines. Save the file.

5. Restart PostgreSQL: open a terminal **as administrator** and run:
   ```
   net stop postgresql-x64-18 && net start postgresql-x64-18
   ```
   (Adjust the number if you installed a different version, e.g. `postgresql-x64-17`)

This is safe for a local development database. It means apps on your machine can connect without a password. Do not do this on a server that other people can access.

### Install pgvector

pgvector adds semantic search (AI-powered "find things similar to X"). Without it, the pipeline still works but falls back to basic keyword search.

1. The PostgreSQL installer includes a program called **Stack Builder**. It may launch automatically after install — if not, find it in your Start menu under **PostgreSQL**.

2. Select your PostgreSQL installation from the dropdown, click Next.

3. Expand **Categories > Spatial Extensions** or search for **pgvector**. Check the box and click Next to install.

4. If pgvector isn't listed in Stack Builder, you can install it manually:
   - Download the Windows build from [github.com/pgvector/pgvector/releases](https://github.com/pgvector/pgvector/releases)
   - Copy `vector.dll` to `C:\Program Files\PostgreSQL\18\lib`
   - Copy `vector.control` and the SQL files to `C:\Program Files\PostgreSQL\18\share\extension\`
   - Restart the PostgreSQL service (same command as above)

The pipeline will pick it up automatically when it runs `/pipeline:init` — no extra config needed.

### psql not recognized?

If `psql` isn't recognized after install, you need to add it to your PATH:

1. Press `Win`, type **Environment Variables**, click **Edit the system environment variables**
2. Click **Environment Variables** button
3. Under "System variables", find **Path**, click it, click **Edit**
4. Click **New**, paste: `C:\Program Files\PostgreSQL\18\bin`
5. Click OK on all dialogs, then **close and reopen your terminal**

---

## 6. Ollama

**What it does:** Runs an AI embedding model locally on your machine — no API keys, no cloud, no rate limits. The pipeline uses it for semantic search across your codebase and session history.

**Required?** Optional. Without it, the Postgres knowledge tier falls back to keyword search only (still useful).

| | |
|---|---|
| **Install** | Download from [ollama.com/download/windows](https://ollama.com/download/windows) and run the installer |
| **Verify** | `ollama --version` |

**Admin not required.** The installer works from your regular user account.

**After install, close and reopen your terminal,** then pull the embedding model:

```
ollama pull mxbai-embed-large
```

This downloads about 670 MB — may take a few minutes on slower connections. It only needs to run once.

---

## 7. Claude Code

**What it does:** The AI coding assistant that runs the pipeline. It lives in your terminal and uses all the tools above.

| | |
|---|---|
| **Install** | `npm install -g @anthropic-ai/claude-code` |
| **Verify** | `claude --version` |

**Admin not required.** This uses npm (installed with Node.js in step 3). If you get a permission error, try running the terminal as administrator for this one command.

**After install,** launch it once to log in:

```
claude
```

It will open a browser window to sign in with your Anthropic account. If you don't have one yet, you can create one at [console.anthropic.com](https://console.anthropic.com). A paid plan is required (Pro or Max).

---

## 8. Design Tools (pick one or both)

Pipeline can generate design mockups during brainstorming and compare them during UI review. You have two options — pick whichever fits your workflow, or use both.

### Which should I pick?

| Situation | Recommendation |
|-----------|---------------|
| **Starting fresh, no existing designs** | **Stitch** — generates mockups from text descriptions |
| **Have existing Figma designs** | **Figma** — imports what you've already designed |
| **Both** | Stitch for brainstorming new screens, Figma for reviewing against existing brand assets |

### Google Stitch (recommended for new designs)

**What it does:** AI-powered design mockup generation from text prompts. During brainstorming, describe what you want and Stitch creates a visual screen. You can refine it, explore variants, and compare against your implementation.

**Free tier:** ~350 generations/month (standard mode) or ~50/month (experimental mode). Any Google account. No credit card required.

**Setup:**

1. **Create account:** Go to [stitch.withgoogle.com](https://stitch.withgoogle.com) and sign in with any Google account. That's it — you're in. You can create projects and screens here manually too, but pipeline does it for you.

2. **Generate an API key:** Click your profile picture (top right) > **Settings** > find the **API Keys** section > **Generate new key** > copy the key. It looks like a long string of letters and numbers. Keep this somewhere safe.

3. **Connect to Claude Code:** Open your terminal and run this command (replace `YOUR-KEY` with the key you copied):
   ```
   claude mcp add stitch --transport http https://stitch.googleapis.com/mcp --header "X-Goog-Api-Key: YOUR-KEY" -s user
   ```
   What this does: it tells Claude Code how to talk to Stitch on your behalf. The `-s user` flag makes it available across all your projects.

4. **Verify:** Run `claude mcp list` — you should see `stitch` listed as connected.

**Troubleshooting:**
- **"command not found: claude"** — Claude Code isn't installed yet (go back to step 7) or your terminal needs to be reopened.
- **Key doesn't work** — Regenerate it in Stitch settings. Make sure there are no extra spaces when you paste it into the command.
- **"mcp add" fails** — Make sure you're running a recent version of Claude Code: `npm update -g @anthropic-ai/claude-code`

### Figma (for existing designs)

**What it does:** Imports your existing Figma designs so pipeline can reference them during brainstorming and compare them against your implementation during UI review.

**Free tier:** 3 design files (unlimited FigJam files). Full API access on all plans.

**Setup has two parts** — a Figma account with an API token, and an MCP server that connects Figma to Claude Code.

**Part 1 — Figma account and token:**

1. **Create account:** Go to [figma.com](https://figma.com) and create an account or sign in.

2. **Generate a personal access token:** Click your profile icon (top left) > **Settings** > scroll to **Personal access tokens** > **Generate new token**. Give it a name (e.g., "pipeline") and copy the token.

3. **Set the environment variable** so the MCP server can use your token:
   - **Windows (PowerShell):** `$env:FIGMA_API_KEY = "your-token"`
   - **Mac/Linux:** `export FIGMA_API_KEY="your-token"`
   - **To make it permanent:** Add the export line to your shell profile (`~/.bashrc`, `~/.zshrc`, or PowerShell profile). Otherwise you'll need to set it every time you open a new terminal.

**Part 2 — Figma MCP server:**

1. **Make sure Node.js 18+ is installed** (step 3 above): `node --version`

2. **Add the Figma MCP server to Claude Code:**
   ```
   claude mcp add figma -- npx -y figma-developer-mcp --stdio
   ```
   What this does: it installs and runs the official Figma MCP server. The server reads your `FIGMA_API_KEY` from the environment automatically.

3. **Verify:** Run `claude mcp list` — you should see `figma` listed as connected.

**Troubleshooting:**
- **"Cannot find module"** — Node.js is not installed or too old. Run `node --version` and make sure it's 18+.
- **"401 Unauthorized"** — Your token expired or is invalid. Regenerate it in Figma settings.
- **Rate limited** — Figma allows ~30 requests/minute. Wait a moment and try again.
- **"figma not connected" in `claude mcp list`** — Make sure `FIGMA_API_KEY` is set in your current terminal session. Run `echo $env:FIGMA_API_KEY` (PowerShell) or `echo $FIGMA_API_KEY` (bash) to check.

---

## 9. Browser Tools (for UI review)

Pipeline's `/pipeline:ui-review` command captures a screenshot of your running app and analyzes it. You need one of these to enable automatic screenshots. If you have neither, you can still provide screenshots manually.

### Chrome DevTools (recommended)

**What it does:** Lets Claude Code control your Chrome browser — take screenshots, navigate pages, inspect elements.

**Setup:** Launch Chrome with remote debugging enabled:

```
chrome --remote-debugging-port=9222
```

On Windows, the full path might be needed:
```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

**Verify:** With Chrome running, open a new terminal and run:
```
curl http://localhost:9222/json/version
```
You should see JSON output with Chrome version info.

> **Note:** You need to launch Chrome this way each time you want to use browser tools. Some people create a desktop shortcut with the `--remote-debugging-port=9222` flag.

### Playwright (alternative)

**What it does:** Headless browser automation — takes screenshots without needing a visible Chrome window.

| | |
|---|---|
| **Install** | `npm add -D @playwright/test && npx playwright install chromium` |
| **Verify** | `npx playwright --version` |

---

## 10. Analytics and Monitoring (optional)

These integrations let pipeline pull context from external services. Set the environment variable to enable each one.

### Sentry

**What it does:** Auto-pulls recent errors in `/pipeline:debug` so you don't have to describe them manually.

```
# Windows PowerShell:
$env:SENTRY_AUTH_TOKEN = "your-token"

# Mac/Linux:
export SENTRY_AUTH_TOKEN="your-token"
```

Get your token at: Sentry > Settings > Auth Tokens.

### PostHog

**What it does:** Provides analytics context during review (user impact data, feature flag status).

```
# Windows PowerShell:
$env:POSTHOG_API_KEY = "your-key"

# Mac/Linux:
export POSTHOG_API_KEY="your-key"
```

Get your key from: PostHog > Project Settings.

---

## 11. Security Audit Tools

**What these do:** Scan your project's dependencies for known security vulnerabilities. They check free, public databases — no accounts, no API keys, no cost.

**Required?** Optional but recommended. Without them, Pipeline's security commands still work but skip the automated dependency audit step.

Pipeline uses whichever tool matches your project's language. Most are already installed with their parent tools.

| If your project uses... | The audit tool is... | How to get it | Vulnerability database |
|---|---|---|---|
| Node.js (npm) | `npm audit` | Already installed with Node.js (step 3) | GitHub Advisory Database |
| Node.js (yarn) | `yarn audit` | `npm install -g yarn` | GitHub Advisory Database |
| Node.js (pnpm) | `pnpm audit` | `npm install -g pnpm` | GitHub Advisory Database |
| Python | `pip audit` | `pip install pip-audit` | Open Source Vulnerabilities (OSV) |
| Rust | `cargo audit` | `cargo install cargo-audit` | RustSec Advisory Database |
| Go | `govulncheck` | `go install golang.org/x/vuln/cmd/govulncheck@latest` | Go Vulnerability Database |

**If you're using npm** (most common), you're already set — `npm audit` comes with Node.js.

**Verify:** Run your project's audit command to test it:
```
npm audit
```

You should see either "found 0 vulnerabilities" or a list of known issues. Both mean the tool is working.

---

## 12. Install the Pipeline Plugin

**This is the last step.** Everything above should be installed and verified first.

```
claude plugin install --scope user https://github.com/djwmobley/pipeline
```

**Admin not required.** Run this from any regular terminal. It downloads the plugin from GitHub automatically.

**After install,** open Claude Code in any project folder and run:

```
/pipeline:init
```

This detects your tools, creates your project config file, and sets up the knowledge tier. Follow the prompts — it will ask a few questions about your project.

---

## Quick Check — Verify Everything

Open a **new terminal** and run all of these. Each one should print a version number:

```
git --version
gh --version
node --version
npm --version
python --version
psql --version
ollama --version
claude --version
claude mcp list
npm audit --help
```

The `claude mcp list` command should show any MCP servers you connected (stitch, figma, etc.). The `npm audit --help` command should print usage info — if you're using a different language, substitute your audit tool (e.g., `pip audit --help`, `cargo audit --help`).

If any command says "not recognized" or "not found", close your terminal, reopen it, and try again. If it still doesn't work, the tool may not be in your PATH — see the notes in each step above.
