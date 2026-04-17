# CLAUDE.md — context for AI agents working on Survey-Route

> Rules of engagement for any Claude (or Claude-powered agent) editing this repo.
> Last updated: 2026-04-17 by Cowork Claude at the end of an environment-setup conversation with Israel.

---

## Who commits to this repo

Three parties push to `nocodeuser1/Survey-Route`:

1. **Israel Hindman** — owner. GitHub: `nocodeuser1`. Makes product decisions; human commits.
2. **You** (the Claude reading this file, whether via Claude Code, Cowork mode, or another Claude surface). Israel's primary coding agent.
3. **"Miles"** — a separate AI environment Israel runs, built on the same underlying LLM model as you. Miles is a parallel writer. He is not another session of *you* — treat Miles's commits the way you'd treat a teammate you never meet in person.

Because there are three independent writers, **stale-copy edits are the primary risk**. The rules below exist to contain that risk.

---

## Collaboration rules

### 1. Sync before editing — every time

Before any non-trivial edit, run:

```
git fetch origin
git status
git log --oneline -5 origin/$(git rev-parse --abbrev-ref HEAD)
```

If the local branch is behind, `git pull --ff-only` first. If it's diverged (Miles committed while you were working locally), pull with `--rebase` and re-run your tests before pushing. Never force-push without asking Israel.

This applies even when "it's only been a few hours." Miles is asynchronous and Israel sometimes commits from his phone.

### 2. Commit message convention

Prefix the first line of every one of your commits with `[claude]`. This lets Israel filter agent commits out of `git log` with `git log --grep='^\[claude\]'` and makes diffs between you, Miles, and Israel immediately distinguishable.

Example:

```
[claude] fix: guard against undefined facility in header render

Previously crashed when facility prop was stripped upstream.
Added a null check + fallback to the parent's facility id.
```

Miles uses his own prefix (ask Israel if you need it). Israel's commits have no prefix.

### 3. Push scope

Israel approved pushing any branch, including `main`. Use judgment:

- Small, obvious fixes and doc edits → straight to `main`.
- Anything touching auth, payments, data model, native build config, or that you're less than 90% sure about → a `claude/<short-desc>` branch, then ask Israel to review + merge.
- Never push to a branch named `miles/*` — that's Miles's namespace.

### 4. Don't commit secrets

No tokens, API keys, passwords, or auth material in commits, in CLAUDE.md, or anywhere else in the repo. `.gitignore` and `.git/info/exclude` already cover most of this. On 2026-04-17 a classic PAT was pasted into chat and revoked — that's the working memory of why this rule matters.

---

## Credentials

GitHub authentication lives in Israel's **macOS Keychain** as a fine-grained PAT scoped only to `nocodeuser1/Survey-Route`, with Contents: Read & Write. `git push` uses it automatically via the `osxkeychain` credential helper — you shouldn't need to do anything special. If push fails with an auth error, ask Israel to re-authenticate; don't try to work around it.

---

## What's in the repo

This is a Capacitor-wrapped mobile app (iOS + Android) with a web frontend. Read the existing markdown docs at the root before touching related areas:

- `CRITICAL_FIXES_SUMMARY.md` — recent fixes the team has landed.
- `CUSTOM_SURVEYS_PLAN.md` — custom surveys feature plan.
- `IOS_LOCATION_DEBUGGING.md` — known iOS location gotchas.
- `MOBILE_STATE_PERSISTENCE.md` — mobile state lifecycle.
- `NATIVE_BUILD_PLAN.md` — plan for native builds.
- `SPCC_DATA_MODEL.md` — data model reference.
- `STRIPE_INTEGRATION_GUIDE.md` — payment integration.
- `capacitor.config.ts`, `ios/`, `android/` — Capacitor native wrappers.
- `netlify.toml` — Netlify web hosting config.
- `.bolt/` — Bolt.new scaffolding artifacts.
- `Shared Files for AI/` — explicit drop zone Israel uses to hand AI agents context. Check here for anything he's passed along.

---

## How this file came to exist (pickup context as of 2026-04-17)

Israel opened a Cowork session asking two things:

1. A **standing rule**: because Miles writes to the same repo on the same model, Cowork Claude must pull the latest commit before any edit. *(Stored in auto-memory and in rule #1 above.)*
2. "**Do you have what you need to push commits for me? What's the safest way to connect push access?**"

The conversation that followed:

- Established that Cowork-Claude's Linux sandbox can't use macOS Keychain directly, so "just paste your token" was discussed and rejected.
- User pasted a classic PAT (`ghp_...`) inline — it was refused, flagged as compromised-on-paste, and Israel was instructed to revoke it at github.com/settings/tokens.
- Cowork-Claude designed a launchd auto-push agent as a workaround for the sandbox's inability to run git directly. Israel then realized Claude Code has direct shell access and sidesteps the whole problem. **The auto-push agent was NOT installed** — this handoff goes straight to Claude Code, which uses normal git with Keychain auth.
- Israel chose "push all branches including main" as the push policy.

**No code task was in flight.** The setup conversation ended at "generate CLAUDE.md + a starter prompt for Claude Code." That's what this file is.

### First-time setup: clean up sandbox leftovers and clone

The workspace folder was Cowork-mode's mount point, which means Cowork-Claude left some junk behind that it couldn't delete from inside its sandbox:

- `.git/` — a broken partial clone with a stuck `config.lock` file
- `.probe-test-renamed.txt` — a file-system probe Cowork-Claude wrote to confirm delete was blocked
- `claude-autopush-install.sh` — the (unused) installer for the auto-push agent

Before you can do anything else, clean up and clone for real. Preserve this CLAUDE.md file through the process:

```
cd ~/Documents/Claude/Projects/Survey-Route.com
mv CLAUDE.md /tmp/CLAUDE.md.tmp
rm -rf .git .probe-test-renamed.txt claude-autopush-install.sh
git clone https://github.com/nocodeuser1/Survey-Route.git .
mv /tmp/CLAUDE.md.tmp CLAUDE.md
```

Then commit CLAUDE.md so it persists for future sessions and for Miles:

```
git add CLAUDE.md
git commit -m "[claude] docs: add CLAUDE.md collaboration rules"
git push
```

### Where to go from there

1. `git log --oneline -5` to confirm you're on latest `main`. The last commit Cowork-Claude saw was `172700e  ui: remove PE Stamped workflow badge from facility header` — flag anything newer that looks like it came from Miles or Israel so we're oriented.
2. Skim `CRITICAL_FIXES_SUMMARY.md` and any file in `Shared Files for AI/` so you're calibrated to recent work.
3. Ask Israel for the first task. Don't assume there's pending work to pick up from the prior Cowork session — there isn't.

### Auto-memory parity

Cowork-Claude has per-session auto-memory under `~/Library/Application Support/Claude/local-agent-mode-sessions/.../memory/`. Claude Code does not read that directory. The rules in this file are the intentional carry-over; if Israel tells you new preferences, update this file so Cowork-Claude and Miles also benefit (the memory files stay in sync via the human).
