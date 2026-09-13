---
name: vercel-deploy
description: Safely validate, build, deploy, and verify Next.js applications on Vercel with context-aware pre-flight checks, local build validation, GCP worker sync, and deployment status verification. Use when deploying to Vercel, releasing code, triggering builds, or verifying deployment health.
---

# Vercel Deployment Protocol

This skill provides a context-aware protocol for building, deploying, and verifying Next.js applications on Vercel without shipping broken builds or desynchronized background workers.

---

## Pre-Flight Verification Checklist

Before initiating any Vercel deployment, execute these verification steps in order:

### 1. Context & Git State Check
```bash
git branch --show-current
git status -u
```
- Confirm active branch (`main` for Production, feature branch for Preview).
- Ensure all intended changes are tracked and committed.

### 2. Local Build Validation (Mandatory)
Never trigger a deployment without testing the build locally first. Vercel build failures waste time and can break production routes.
```bash
npm run build
```
- If TypeScript, ESLint, or Next.js build errors occur, fix them immediately.
- Do NOT proceed to deploy until `npm run build` succeeds with `Exit code: 0`.

### 3. GCP Worker Sync Check (Project Requirement)
Vercel deploys **only** the Next.js web application. Background queue execution and drafting run on the GCP VM (`helios-orch-worker`).
- Check if changes touch any of:
  - `lib/orchestration/**`, `lib/drafting/**`, `lib/pre-enriched-ingest.ts`, `lib/storage.ts`
  - `scripts/orchestration_worker.ts` or worker environment/config
- If worker code or worker env changed, run:
  ```bash
  ./scripts/gcp/deploy-worker-code.sh
  npm run worker:status
  ```

---

## Deployment Protocols

### Option A: GitHub Integration Deployment (Recommended)
Pushing to the remote repository automatically triggers Vercel deployments.
```bash
git add .
git commit -m "<descriptive commit message>"
git push origin <branch-name>
```

### Option B: Vercel CLI Deployment (Fallback)
If deploying directly via CLI, verify project link in `.vercel/project.json` first:
```bash
npx vercel --prod
```

---

## Post-Deployment Health Check

After triggering a deployment, monitor its progress to ensure it succeeds in Vercel:

### 1. Check Deployment Status via GitHub API
```bash
gh api "repos/:owner/:repo/deployments?per_page=3"
```
Get the latest deployment ID and inspect its status:
```bash
gh api "repos/:owner/:repo/deployments/<DEPLOYMENT_ID>/statuses"
```

### 2. Status Resolution
- **`success`**: Deployment is live. Verify the target URL.
- **`failure`**: Retrieve logs via Vercel inspect, fix the issue locally, verify with `npm run build`, and push a fix.
- **`pending` / `queued` / `building`**: Wait 10-15 seconds and re-check.

---

## Protocol Checklist Summary

Copy and track during deployment tasks:

- [ ] 1. Check git status and current branch
- [ ] 2. Run `npm run build` locally and verify 0 errors
- [ ] 3. Redeploy GCP VM worker if orchestration/drafting/env code changed
- [ ] 4. Push commit to remote branch or deploy via Vercel CLI
- [ ] 5. Poll GitHub/Vercel deployment status until `success` confirmed
