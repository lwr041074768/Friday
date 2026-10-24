# Public verification

Run these commands after `npm ci` with Node.js 22.13 or later. Build once before the aggregate desktop regression:

```powershell
npm run typecheck
node desktop/build.mjs
node scripts/verify-ph.mjs
node scripts/verify-cv.mjs
node scripts/verify-eis-contour.mjs
node scripts/verify-eis-bode.mjs
node scripts/verify-eis-auto-fit.mjs
node scripts/verify-desktop-all.mjs
```

The pH regression generates two analytical acquisitions with declared slopes 0.5 and 0.75, covering text and synthetic CHI BIN import, units, sample ownership, repeat imports, selection, signed currents, interpolation, gaps, scan cycles, iR and RHE settings, CSV/XLSX/Origin packets and project roundtrips.

The CV regression generates Laviron peaks from known alpha and rate-constant values. It checks scan direction, four-cycle identity, peak gaps and shoulders, duplicate rates, a 150,000-point branch, text import, complete raw export, typed XLSX and project roundtrips.

EIS contour and Bode regressions use constructed spectra with explicit signed imaginary values, frequency ranges, gaps and repeated potentials. The automatic-fit regression constructs known circuits and checks selection, parameters, model coverage and immutable input.

Test outputs are written to ignored output directories. Each successful command reports its actual checks. Optional native Origin/JADE and graphical UI checks also require their documented applications and fixtures.

The retained synthetic UI scripts accept `PLAYWRIGHT_MODULE` pointing to Playwright's `index.mjs`, or discover an installed `playwright` package. They print an explicit skip when the optional package is unavailable. Build the desktop app before running them.

Six historical acquisition-specific UI scripts are excluded from this public source snapshot: `verify-ph-ui.mjs`, `verify-ph-repeat-ui.mjs`, `verify-area-default-ui.mjs`, `verify-folder-drop-ui.mjs`, `verify-eis-contour-ui.mjs`, and `verify-eis-bode-ui.mjs`. The published numeric regressions use generated fixtures.

## Verified publication snapshot — 2026-10-25

The public source snapshot passed `node desktop/build.mjs` and all **44 checks** in `node scripts/verify-desktop-all.mjs` (`passed: true`, `failed: []`). The aggregate includes desktop TypeScript, Cdl/LSV/EIS/pH/CV computations and imports, exports, project roundtrips, native request validation and isolated updater-installation checks.

Standalone pH, CV, EIS contour and Bode regressions also passed. The pH fixture contains 10 generated files and 20,000 original rows; five- and four-point slopes both recover the declared 0.5 and 0.75. The CV fixture exports 16,068 original rows and recovers alpha = 0.45 and Ks = 0.01 from its declared analytical peak equations.

All four retained optional synthetic UI scripts passed JavaScript syntax checking. Playwright was absent from the publication workspace; the UI entry points reported an explicit dependency skip. This publication check therefore records numeric/build/integration results separately from graphical UI verification.

Application source and assets under `app/`, `components/`, `lib/` and `public/` were byte-compared to the development project and matched. Publication edits affect documentation and verification portability.
