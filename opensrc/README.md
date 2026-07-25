# Open Source Notes

This folder records open-source dependencies or upstream projects that matter to the agent runtime.

Do not vendor large upstream repos here by default. Prefer npm/package-manager dependencies plus a short provenance note with source, license, and the local package that uses it.

`opensrc/sources.json` is the source inventory.
Run `npm run opensrc:sync` to fetch every source and verify cache freshness.
Run `npm run opensrc:install-schedule` once to install the daily macOS user sync.
GitHub Actions also runs the same refresh daily.
