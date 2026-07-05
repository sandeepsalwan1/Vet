---
name: run
description: >
  Project-specific launch instructions for the Central Veterinary Hospital app.
  Use this skill whenever asked to run, start, launch, open, or preview the app —
  or to confirm a change works in the running app. This project has one unified
  Next.js app: apps/internal on :3000. Use this skill even when the user just says "run it"
  or "can you start the app" — don't wait for them to specify which one.
---

## App in this project

| App | Script | URL |
|---|---|---|
| Unified VetAgent app | `npm run dev` | http://localhost:3000 |

Public client flows live in the same app at `/arrival`, `/booking`, `/pickup`, `/records`, `/followup`, `/call`, and `/request`.

## Prerequisites (check once per session)

1. **`.env.local` exists** with Supabase `DATABASE_URL` set. Without it the API returns 503. If missing, tell the user and stop.
2. **`node_modules/` present** at the root. If not, run `npm install` first.
3. **Migrations applied** — only needed on a fresh database. Run `npm run db:migrate` if the user says the DB is new or if API calls return schema errors.

## Starting the app

Run in the background so you can continue working:

```powershell
npm run dev
```

Use `run_in_background: true` when calling Bash so the process doesn't block. Wait ~5 seconds for Next.js to finish compiling before opening the browser.

## Verifying in the browser

After starting, use the browser tools to open the URL and take a screenshot confirming the page loaded. The staff task board should render, and public flows should be reachable under their route paths.

If the page shows a "Database not configured" error: `.env.local` is missing or `DATABASE_URL` is wrong.  
If the page shows a Next.js compile error: there's a TypeScript or import issue — read the terminal output.

## Common situations

- **Port already in use**: Next.js will print an error. Ask the user if they want to kill the existing process or use a different port.
- **After a code change**: The dev server hot-reloads automatically. Just refresh the browser (or wait a moment for the HMR update) — no need to restart the server unless a config file changed.
