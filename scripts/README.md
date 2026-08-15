# Website design import

The reviewed runtime artifact is `apps/demo/src/app/claude-design.generated.ts`. It is committed and is sufficient for a clean checkout and production build.

To refresh it from a new Claude Design export:

```powershell
node scripts/import-claude-design.mjs "C:\path\to\Resvary Site.html" apps/demo/src/app/claude-design.generated.ts
npm run design:check
npm --prefix apps/demo run build
```

The importer preserves the approved visual markup while applying Resvary copy, semantic hooks, accessibility landmarks, internal demo targets, font/color tokens, and interaction integrity checks. It fails when an expected source string is missing, so a changed Claude export must be reviewed instead of silently importing partial transformations.
