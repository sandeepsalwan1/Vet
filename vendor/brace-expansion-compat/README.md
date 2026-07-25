# brace-expansion compatibility shim

This private package exposes the patched `brace-expansion` v5 implementation through both its current object API and the callable CommonJS API required by `minimatch` v3.
The root dependency ensures a clean `npm ci` installs the local override, so Knip intentionally ignores that package-plumbing dependency.
Remove it when the held ADK and ESLint dependency lines no longer install `minimatch` v3.
