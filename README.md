# ThemeForge — local Git repository → theme folder generator

ThemeForge is a **local-only** tool for Windows. You give it a public HTTPS Git URL, a category name and a template name; it clones the repository into a temporary folder, analyses it, and produces a theme folder that follows the structure of `refrence-theme-structure/`:

```
<template>/
  theme.json                         key, title, type, categorySlug, previewImage, homeSectionOrder, sectionVariants, pages
  theme-manifest.json                what was included/excluded, mappings, unresolved imports, warnings, validation
  addons/floating.json
  assets/<group>/<file>              images keep their source sub-folder (public/team/1.jpg -> assets/team/1.jpg)
  assets/icons/…                     svg icons
  components/<Name>/<Name>.tsx       <Name> = <TemplatePascal><SectionType><n>, e.g. ComputerRepairingBanner1
  components/<Name>/component.json   key, sectionType, sectionNumber, scope, folder, editorFields, defaultContent
  styles/globals.css                 the repository's global stylesheet(s), as found
  styles/variables.css               generated: every :root variable collected from those stylesheets
  styles/fonts/<file>                web fonts (woff/woff2/ttf/otf/eot)
```

The reference itself has no `styles/` folder — its components inline the `:root` variables at runtime (see *Host boilerplate* below). ThemeForge does the same injection **and** keeps the readable copies in `styles/` so the variables and fonts are available alongside the components.

Nothing is deployed, no database, no accounts, no cloud services, no paid APIs. Source repositories are **never executed, installed or built** — files are only read and copied.

## Windows setup

1. **Install Node.js 20 or newer** from <https://nodejs.org> (LTS). Verify in PowerShell: `node -v`.
2. **Install Git for Windows** from <https://git-scm.com/download/win>. Verify: `git --version`.
3. **Install dependencies** in this folder:
   ```powershell
   npm install
   ```
   If npm reports that `esbuild`/`unrs-resolver`/`sharp` install scripts are pending approval (npm 11.17+), run:
   ```powershell
   npm approve-scripts esbuild unrs-resolver sharp
   npm rebuild esbuild unrs-resolver sharp
   ```
4. **Configure the workspace path (optional).** All generated data lives under one directory, by default `C:\ThemeForge`. To change it, copy `.env.example` to `.env.local` and edit:
   ```
   THEMEFORGE_HOME=D:\ThemeForge
   THEMEFORGE_CLONE_TIMEOUT_MS=120000   # clone timeout
   THEMEFORGE_MAX_REPO_MB=200           # abort if the clone is bigger
   THEMEFORGE_MAX_FILES=5000            # abort if the clone has more files
   ```
   The directory and its sub-folders are created on first run:
   ```
   C:\ThemeForge
     workspace\jobs\<jobId>\job.json          job snapshots (status, stages, log)
     output\<category-slug>\<template-slug>\  generated theme folder
     output\<category-slug>\<template-slug>.zip
     templates\default-theme.json             editable theme specification (seeded from .\templates)
   ```
   Clones go to `%TEMP%\themeforge\<jobId>\repo` and are deleted when the job finishes.
5. **Start the app:**
   ```powershell
   npm run dev
   ```
   The server binds to `127.0.0.1` only (`next dev -H 127.0.0.1 -p 3005`), so it is not reachable from other machines on your network.
6. **Open** <http://127.0.0.1:3005> (or <http://localhost:3005>). If another app already listens on port 3005 on all interfaces, `localhost` may resolve to it via IPv6; use `127.0.0.1:3005` explicitly or stop the other app.
7. **Run the tests:**
   ```powershell
   npm test
   ```

Other scripts: `npm run lint`, `npm run typecheck`, `npm run test:watch`.

## Using the dashboard

Fill in the three fields and click **Generate Theme**:

| Field | Example |
| --- | --- |
| Git repository URL | `https://github.com/Shubh9540/computer-repairing` |
| Category name | `Repairing & Maintenance` → folder `repairing-and-maintenance` |
| Template name | `computer-repairing` → folder `computer-repairing`, component prefix `ComputerRepairing` |

The stage list shows the real job state (validate → clone → spec → scan → detect → map → copy → manifest → validate output → zip → cleanup). When the job succeeds you get the detected project info, a folder tree, the component table, the full file mapping, the excluded files with reasons, warnings/unresolved imports, the validation report and a **Download ZIP** button. **Generate Another Theme** resets the form.

## How mapping works

Everything is driven by the JSON specification in `C:\ThemeForge\templates\default-theme.json` (seeded from `templates/default-theme.json` in this repo; the copy under `C:\ThemeForge` is the one that is loaded, so edit that one). It defines:

- `requiredDirectories` / `requiredFiles` — what the output must contain (`addons`, `assets`, `components`, `theme.json`, `addons/floating.json`).
- `naming` — component prefix (`{TemplatePascal}`), suffixes stripped from source names (`HeroSection` → `Hero`), `sectionTypeAliases` (`Hero` → `Banner`, `TopBar` → `Topbar`, …) and `folderBySectionType` (`Banner` → `banner`, …).
- `sources` — where components, pages and data files are looked for.
- `mappings` — ordered glob rules: first match wins. Each rule has a `kind` (component, image, icon, font, style, other), `match`/`ignore` globs, `stripPrefix` and a `target` template using `{relativeDir}`, `{basename}`, `{stem}`, `{ext}`, `{ComponentName}`.
- `exclude` — directories (`node_modules`, `.git`, `.next`, `dist`, …), file globs (`.env*`, keys, certificates, lockfiles, archives, executables), framework boilerplate assets, and regexes for secret *content* (private keys, GitHub/AWS/Slack/OpenAI-style tokens). Matching files are reported in the manifest, never copied.
- `conflicts.policy` — `rename` (default: `Inter.woff2`, `Inter-2.woff2`), `skip` or `error` when two sources map to one target. `conflicts.existingOutputPolicy` — `replace` (default, logged as a warning), `error` or `version` when the output folder already exists.
- `transformations` — all deterministic and individually switchable:
  - rename the exported component identifier to the new name and add a default export;
  - rewrite imports between theme components to `../<Name>/<Name>`;
  - report every other local import (e.g. `@/types/...`) as **unresolved** instead of silently breaking the file;
  - extract `editorFields` from `data.x` / `data?.x` / destructuring usage and append the `editorFields` static like the reference components;
  - locate `defaultContent` in the repository's JSON data files by key similarity and rewrite asset paths to be relative to `assets/`;
  - **host boilerplate** (`injectCssVars`, `hostAssetMapper`): the reference components never load a global stylesheet. Instead each component starts with a self-guarding IIFE that appends `<style id="theme-upload-css-vars">:root{…}</style>` once, and passes `data` through `mapThemeUploadAssetsInData` (imported from `../../../lib/restaurantFoodAssets`, a helper that lives in the *host*, not the theme) so `assets/`-relative paths in `defaultContent` resolve to the uploaded URLs. ThemeForge collects `--custom-properties` from `:root` / `html` / Tailwind `@theme` blocks of the repository's stylesheets (`globals.css` wins) and emits the same two lines as the first statements of every component; expression-bodied arrow components are converted to a block body first. The collected variables are also recorded as `cssVariables` in the manifest. Disable either part with `"enabled": false`, or change `importPath`/`importName`/`styleId` to match a different host.
- `assets.optimizeImages` — compresses `jpg/png/webp/avif` with [`sharp`](https://sharp.pixelplumbing.com/) while copying them into `assets/`. The format and extension never change (so `defaultContent` paths stay valid); images wider than `maxWidth` (1920) are downscaled, never enlarged; quality is controlled per format (`jpegQuality`, `webpQuality`, `avifQuality`, `pngQuality` + `pngPalette`); files smaller than `minBytes` (10 KB), undecodable files, or results that would not be smaller are copied byte-for-byte. Set `enabled: false` to copy originals. The dashboard's mapping tab shows the per-file savings and the manifest records `imageOptimization` totals.
  - **host editor fit** (`seedFieldShapes`, `excludeEditorFields`, `naming.hostSectionTypes`): the host's section editor (`apps/frontend/.../builder/EditSectionModal.tsx`) only shows the keys listed in `editorFields`, renders *nothing* for an empty object, and cannot "Add item" to an empty list (it clones the first item). ThemeForge therefore reads how the component uses each field (`data.badge.label`, `data.cards.map(c => c.title)`, `(data.benefits || []).slice(…)`) and seeds missing or hollow values as `{ label: "" }` / `[{ title: "" }]`; a list whose items cannot be traced borrows a blank sample from a sibling (`navLinksRight` ← `navLinksLeft`). Internal keys (`id`, `slug`, …) stay in `defaultContent` but are dropped from `editorFields`. `sectionType` is normalised to the host's registry vocabulary via `sectionTypeAliases` (`WhyChoose` → `WhyChooseUs`, `PhotoGallery` → `Gallery`, `Quote` → `Enquiry`, `Brands` → `Partners`, `FaqPage` → `FAQPage`, …); unknown types still work generically but are reported.
  - **host field names** (`hostFieldAliases`): content keys are renamed to the vocabulary the host editor keys its controls on, consistently across the component code (`data.x`, `data?.x`, `data["x"]`, destructuring, type literals, object literals), `defaultContent` and `editorFields`. `camelCase: true` turns `title_line1`/`button-text` into `titleLine1`/`buttonText`; `fields` maps generic synonyms (`img` → `image`, `bg` → `backgroundImage`, `titleLine1`/`heading` → `title`, `faqs` → `faqItems`, `socials` → `socialLinks`, `copyright` → `copyrightText`, …) and is also applied to the camelCased result in the same hop; `bySectionType` renames top-level collections per section (`Gallery.items` → `galleryItems`, `WhyChooseUs.items/features` → `whyChooseUsItems`, `Stats.items` → `stats`, `FAQ.items` → `faqItems`, `Header.links` → `menu`, …). A rename is skipped — and reported in the manifest/report — when it would collide with an existing key, chain into another rename, change the value kind the host expects (e.g. an object under `backgroundImage`), or when a section-level key is also used nested. Local variable names are never touched, so `const { titleLine1: title_line1 } = data` keeps the JSX working.
- `validation` — max file size, forbidden extensions, at-least-one-component, plus host-fit warnings: `HOST_SECTION_TYPE` (type unknown to the editor), `HOLLOW_FIELD` (`{}`/`[]` the editor cannot edit), `IMAGE_KEY_NAME` (an image path under a key the editor won't give an image picker — it only recognises `image`/`…Image`/`poster`), `ITEMS_NOT_ADDABLE` (the host blocks adding to a collection named `items` outside a few section types).
- `themeJson` — page type labels, preview-image preference, addon files.

Pages are discovered from `app/**/page.tsx` (and `pages/*`): the imports are resolved to theme components and the JSX order becomes the page's `sections`; the home page order becomes `homeSectionOrder`.

Add another specification by dropping a `*.json` file into `C:\ThemeForge\templates`; it appears in the dashboard's dropdown and at `GET /api/templates`.

## API (all local)

| Method & path | Purpose |
| --- | --- |
| `POST /api/generations` | Start a job. Body: `{ repoUrl, category, template, specId? }`. Returns `202 { job }` or `400` with field issues. |
| `GET /api/generations` | List in-memory jobs. |
| `GET /api/generations/{jobId}` | Status, stages, log, detected project, output paths. |
| `GET /api/generations/{jobId}/preview` | Folder tree + full manifest (once succeeded). |
| `GET /api/generations/{jobId}/download` | Streams the ZIP (path taken from the job record, never from the request). |
| `GET /api/templates` | Lists specifications in the templates folder (with validation status). |
| `GET /api/health` | Node/Git versions, workspace path and writability, limits, allowed hosts. |

**Job state is kept in memory.** Restarting `npm run dev` clears the job list (the dashboard will report "Job not found" for old ids). Generated folders and ZIPs stay under `C:\ThemeForge\output`; a `job.json` snapshot is written to `C:\ThemeForge\workspace\jobs\<id>`. If the server is killed mid-clone, a leftover folder may remain in `%TEMP%\themeforge` — it is safe to delete.

## Security notes

- Only `https://` URLs on an allow-list of providers (`github.com`, `gitlab.com`, `bitbucket.org`, `codeberg.org`, `gitea.com`, `git.sr.ht`) are accepted; credentials, custom ports, IP literals, `localhost`/`.local` are rejected and the host must resolve to a public address (SSRF guard).
- Git runs via `execFile` with an argument array (no shell), `--depth 1`, symlinks disabled, hooks and credential helpers neutralised, `GIT_TERMINAL_PROMPT=0`, and a hard timeout. Repository size and file-count limits abort the scan.
- The scanner never follows symlinks or junctions and refuses anything that resolves outside the clone. Target paths are validated against traversal, absolute paths and Windows reserved names; output is written only under the managed output directory and temp folders are deleted only when inside the managed temp root.
- `.env*`, private keys, certificates, tokens (by filename *and* content), `.git`, dependencies, build output, archives and executables are excluded.
- No endpoint reads or writes arbitrary filesystem paths.

## Project layout

```
app/                      Next.js App Router UI + route handlers (app/api/**)
components/dashboard/     dashboard UI (form, stage list, project info, report, folder tree)
components/ui/            small Tailwind primitives (no shadcn/ui present in this workspace)
lib/themeforge/           config, validation (URL/SSRF), git, scanner, mapper, analysis, transform,
                          generator, validator, tree, zip, in-memory jobs
templates/                bundled theme specifications (seeded into THEMEFORGE_HOME/templates)
tests/                    vitest suites with synthetic fixtures (temp dirs, no network except one
                          negative clone test against github.com)
refrence-theme-structure/ the reference theme this tool reproduces (not part of the app build)
```
