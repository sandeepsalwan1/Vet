# brace-expansion compatibility shim

This private package exposes the patched `brace-expansion` v5 implementation through both its current object API and the callable CommonJS API required by `minimatch` v3.
Remove it when the held ADK and ESLint dependency lines no longer install `minimatch` v3.
