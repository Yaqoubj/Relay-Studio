# Organizer redesign: decision and implementation handoff

Prepared September 26, 2026. Design baseline: commit `25588d7`. O1–O6 now have a source implementation; validation is pending.

## Start here

The user subsequently authorized **all O1–O6 tasks** and then explicitly requested stopping before testing so another model can validate them. That instruction supersedes the earlier O1-only sequencing. The next work is [validation and screenshots](organizer-test-handoff.md), not another product brainstorm. Other toolbox expansion remains paused.

The desired outcome is: choose a personal location, see a sensible arrangement based on related files and existing folders, adjust only what needs attention, and organize with one clear action. Physical organization remains the core. A tag-only library is not a replacement for that requirement.

This handoff does not request coding, application installation, repository forks, or a release in the planning turn. It does not require another confirmation to implement routine details once the user asks to build O1. Keep source changes reviewable, update documentation and real screenshots after implementation, and leave installer/release publication and tags to the user.

## Decision: one organizer, selective reuse

Keep Relay's Electron, React, TypeScript, SQLite, document extraction, and verified file-operation journal. Build the new experience and grouping/resolution logic in this stack. Do not bundle complete competing applications or give independent engines overlapping responsibility for the same files.

Forking makes an independently maintained copy of a repository; it does not automatically turn that application's features into a library. Bundling full programs would also require their runtimes, configuration, stores, update handling, and failure recovery. Size is one constraint; integration complexity and consistent file ownership are larger ones here.

| Project | Verified licensing/technical position | Decision for Relay |
| --- | --- | --- |
| [EasyTidy community repository](https://github.com/EasyTidy/EasyTidy) | Root [MIT license](https://github.com/EasyTidy/EasyTidy/blob/main/LICENSE); C#/.NET/WinUI application. Its README separately identifies a GPL3 Snap2HTML template. Pro features documented elsewhere are not automatically covered by the community repository's MIT grant. | Main reference for approachable file automation. Small, independently useful MIT components may be adapted if their exact source and dependencies justify it. No whole app, WinUI runtime, or Snap2HTML import. |
| [tfeldmann/organize](https://github.com/tfeldmann/organize) | [MIT](https://github.com/tfeldmann/organize/blob/main/LICENSE.txt); Python command-line application with file/content filters, actions, conflict handling, and simulation. | Main engineering reference for deterministic conditions and action semantics. Port a small suitable component only when it saves work after tests and attribution; do not embed its Python runtime or expose scripts as the normal UI. |
| [TagStudio](https://github.com/TagStudioDev/TagStudio) | [GPL-3.0-only in current project metadata](https://github.com/TagStudioDev/TagStudio/blob/main/pyproject.toml); Python/PySide application. | Learn from collection browsing and keeping existing folders. Do not copy its code into the current MIT application. |
| [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) | [GPLv3 license](https://github.com/paperless-ngx/paperless-ngx/blob/dev/LICENSE); separate document-management application with its own server/dependency stack. | Learn from document evidence, metadata, inbox handling, and corrections. No bundled Paperless server or copied implementation in this task. A separate user-configured connector could be evaluated later. |
| Hazel and File Juggler | Commercial products under vendor licenses; their documentation is not a reusable source-code license. | Reference their visible workflows and documented behavior; implement Relay's own behavior. |
| [FileBot](https://www.filebot.net/) | Current [EULA](https://www.filebot.net/eula.html) prohibits modification, redistribution, and derivative works. | Reference collection-specific media matching. Do not bundle/fork the current product. Any later media-data integration must use separately permitted data/API access. |

GPL projects can be forked under their terms. The decision above preserves Relay's current MIT distribution approach; it is not a claim that GPL reuse is universally forbidden. A language translation of copied code still needs the original license obligations considered. For every reused permissive component, record its upstream URL, exact revision, license, copyright notice, changes, and necessary dependency notices. Do not assume logos, datasets, models, or Pro features have the same terms as a repository's root code.

No specific upstream component has been selected or copied. O1 should normally need no new runtime or model. Existing dependencies already cover its metadata, thumbnail, persistence, and file-operation requirements.

## Size and performance decision

The existing local `dist/win-unpacked` directory measured approximately **657.1 MiB** on September 26. This is the sum of unpacked file lengths, not installer download size or memory consumption; the artifact was built in the preceding task. No combined competitor build has been measured, so do not invent a combined size estimate.

For O1, target no new application runtime and less than 10 MiB added unpacked code/dependencies relative to a same-environment baseline. This is an engineering budget, not a measured promise. Optional model weights belong in a later, explicit download with reported size, never silently inside the core installer. Thumbnails/indexes are user data and need separate bounded retention.

Measure scan, analysis, rendering, and copy costs separately. A faster scan does not imply a faster cross-drive copy. Avoid decoding every picture or hashing every file during an ordinary planning pass; hash only for operations that require content verification or explicit duplicate comparison.

## What is wrong with the current implementation

The source currently has separate Scan files and Build review actions, a long path table, a review checkbox, and a second native apply confirmation. The main smart planner uses broad categories, episode-name patterns, modified-month/thumbnail photo grouping, and fixed AI document topics. It does not map the user's existing libraries or remember collection destination choices.

The shared file policy is incomplete. `assertSafeToReorganize` inspects only two parent directories; detection and exclusions are also distributed across scanner, graph engine, and batch collector. A folder named `Pictures` is skipped by current smart planning simply because its name appears in a fixed managed-output set. That can hide legitimate source content. Resolve these with explicit context and recorded ownership rather than another list of special-case names.

Keep the proven exclusive writes, streaming hash verification, source identity checks, collision checks, journal, cancellation boundaries, and guarded undo. Do not replace them with unjournaled filesystem renames to simplify the UI.

## O1 — Direct organization with related groups and existing destinations

### Included user experience

1. Home's organization card and the primary File organizer navigation open the new flow. Familiar shortcuts include Downloads, Desktop, Documents, and Choose folder. Resolve actual OS locations, including redirected folders; displaying a shortcut alone must not grant access or start scanning it.
2. Selecting a source starts one cancellable preparation operation. Do not make users separately select a template, run a scan, and build a plan. Display actual progress and incomplete-scan status.
3. Default placement is inside the selected location. Reuse suitable existing folders within that grant. An optional library setting lets the user explicitly choose and remember external Pictures, Videos, Documents, and other destinations. No external destination is scanned or written merely because its path can be guessed.
4. Show collection cards: title, representative thumbnails or document snippets when available, file count/size, destination, and a short reason. Mark a destination as Existing folder or New folder. Show the actual resulting path, even when its root has a friendly display name.
5. A compact folder tree shows the proposed arrangement. Each collection supports Include/exclude, Change destination, and Keep here. Keep here means no filesystem change. Uncertain files and conflicting groups remain in place and are shown under Needs attention. Detail rows remain available, without becoming the primary experience.
6. One **Organize** action applies the visible selected plan. Remove the duplicate checkbox/native confirmation for this new, explicitly reviewed flow. Retain main-process authorization, plan identity/revision validation, and all filesystem preflight checks. Permission requests for an ungranted output location remain meaningful and separate.
7. Completion shows completed files/groups, partial failures, unchanged items, Open destination, and supported Undo. The result and recoverable journal remain available after restart. Unknown items must not be physically relocated into a staging or Other folder.

Existing specialized tools and their saved setups remain accessible under an Advanced entry. Preserve graph workflows and their history. Do not add a second nearly identical organizer beside the current smart route. The new primary route replaces that experience.

### Required grouping behavior

- **Episodes and companions:** Recognize supported media names locally. Keep matched subtitles, language variants, and known sidecars with their episode. Use series/season groups; a file with an unknown extension and an episode-like stem is not a video. Ambiguous companion matches remain pending.
- **Photos:** Use trustworthy EXIF capture dates when available, preserving capture-calendar semantics. Reuse existing photo destinations. Use a monthly subfolder only when the collection merits it; default to at least three related photos before creating a new month folder. With missing dates, leave them at the general photo destination rather than inventing an event or treating modification time as capture time. Keep verified RAW/JPEG/sidecar pairs together. Visual similarity is a suggestion, not proof of duplicate content or a shared event.
- **Loose documents and other supported personal files:** Use a sensible existing type/collection destination and retain the original filename. Deep document-topic understanding is O2. Do not present extension sorting as semantic understanding.
- **Existing folders:** Inventory enough structure to identify candidate destinations and intact bundles. Treat existing course, project, game, application, and unfamiliar multi-file folders as units that remain intact in O1. Do not flatten their contents. Moving whole folders requires a separate tested bundle journal and is outside O1.
- **Few useful folders:** Prefer existing destinations, avoid redundant `Videos/Videos` or `Pictures/Pictures` nesting, avoid chains of singleton directories, and make a second run produce no new changes on already organized input.

The basic pass is read-only until Organize. It can inspect nested directory metadata for context within the selected grant, but it must not infer permission to dismantle every subfolder. Whole drives are not the default O1 entry point; broad disk inventory is O6.

### Destination resolution

Use this precedence: explicit current user choice; saved, scoped destination mapping; one unambiguous compatible existing collection; a proposed new folder inside the authorized default root. A conflict at a stronger level must be shown, not silently routed to a weaker fallback.

Resolve collections using supported evidence: normalized series title plus season and available year, known directory role, or explicit destination mapping. Never treat similar folder names alone as proof. Two plausible series folders or different remakes with the same name require a choice. Display that choice once per group. Do not search every disk for matches in O1.

Persist only choices the user explicitly elects to remember. A saved library root is not permission for an AI to invent arbitrary descendant paths. Validate derived names and paths centrally. Missing, disconnected, protected, or changed destinations produce a clear pending state; do not silently relocate to a different drive.

### Safety and ownership requirements

- Extend the source policy to actual ancestor context, including selecting a nested folder inside a managed application/project. Do not rely on the current two-parent limit. Cache directory evidence per operation to avoid repeated reads. Also validate destination context before writes.
- Keep recognized app/game trees, `.relay-preserve` trees, links/junctions, hard-linked sources, incomplete downloads, and unsupported types unchanged. Conservative skips must carry a reason; no policy can claim to identify every application folder.
- A grouping decision and a permission decision are separate. Evidence that files look related never grants access or overrides a protected context.
- Selection of an episode/sidecar pair is indivisible in the ordinary UI. The main process enforces complete related-set selection too. Category groups can contain several such independent sets.
- Check all selected source identities and destinations before the first write, then recheck at each operation. A destination collision holds back the affected related set. Never silently overwrite, rename, or delete to resolve it.
- Group selection is not a filesystem transaction. If interruption happens between files, record partial completion, stop safely, and expose recovery/undo for verified effects. Do not claim atomic multi-file moves or exactly-once execution.
- Do not remove newly encountered source directories just because they become empty. Undo removes only empty directories recorded as created by that run.
- Current test fixtures under the repository can conflict with stronger ancestor protection. Use genuinely eligible isolated fixture roots, or injected filesystem trees for policy tests. Do not weaken production protection to make fixtures pass.

### Suggested implementation boundaries

These names are guidance, not a requirement to create a framework or every listed module.

| Area | Required change |
| --- | --- |
| `src/shared/organizer.ts` | Add typed group/related-set metadata, reason/status, destination reference, and plan revision. Keep legacy records readable. Distinguish already organized, deliberately kept, protected, uncertain, and conflicting outcomes. |
| `src/desktop/file-policy.ts` | Centralize contextual eligibility and protection evidence used by scanner and mutation paths. Fix ancestor depth and destination validation without globally disabling useful personal-file operations. |
| `src/desktop/organizer.ts` | Preserve scanner/executor/undo guarantees; supply folder context and expand valid selected groups to journaled file actions. Retain resumable limited scans. |
| `src/desktop/smart-organizer.ts` | Replace blanket output-name skipping with evidence/ownership; reuse existing directories, preserve related sets, improve photo dates, and produce deterministic groups. Small separate grouping/resolver modules are appropriate if this file would otherwise become harder to maintain. |
| `src/desktop/database.ts` | Additive storage for destination mappings and new plan metadata. The existing plan-body plus per-item store can carry additive fields; do not introduce another database. Preserve old plans and interrupted states. |
| `src/desktop/main.ts` | One prepare operation; validated update/replan and apply by plan ID/revision. Canonical persistent grants for remembered roots, session-safe input handoff, existing operation lock, and throttled progress. |
| `src/desktop/preload.ts`, `src/shared/types.ts` | Expose narrow typed methods. Renderer sends choices/IDs, not an arbitrary executable path list. Revalidate plan revision after any awaited permission interaction. |
| `src/studio/Organizer.tsx`, `Toolbox.tsx`, `App.tsx` | New primary flow, grouped visual outcome, optional details, concise completion, and route to specialized legacy tools. A dedicated UI component is reasonable; retain one authoritative plan. |

Changing source, placement, selection, or destination invalidates the displayed apply revision. Destination changes should rebuild the affected plan using the current scanned context where safe, not launch another full disk scan. Changes to input content still require revalidation. Counts in the UI must match the executor's exact selection.

The current executor explicitly requires plan version 1 and checks every destination against the single `options.destination`. Use a version 2 plan for the new flow with an approved destination-root map and an explicit root reference on each related set/item. Resolve each reference in the main process and enforce containment, grant validity, and protected-context checks for both apply and undo. Never widen the single legacy root to an entire drive as a workaround. Preserve a version 1 adapter for existing plans and specialized tools; unknown versions must fail clearly. Persist enough destination identity to detect a disappeared or replaced library after restart. Add a test proving that a forged or ungranted root reference cannot write outside the approved roots.

Keep heavy thumbnail/metadata work bounded and outside the renderer; use the existing runtime for a worker if profiling shows main-process blocking. Do not send full file contents or huge batches repeatedly over IPC. Return requested detail pages and bounded thumbnail previews. For a limited scan, show that only the completed section is being proposed and never imply the whole source was analyzed.

### Concrete acceptance fixtures

Use synthetic content and an isolated app-data directory. Never test mutation against the user's Downloads, games, saves, or real collection.

| Fixture | Required result |
| --- | --- |
| Downloads with three episodes, matching subtitles, and an existing series/season folder | One clear collection destination; original names retained; all companions follow their episode; no duplicate library tree. |
| Two existing series directories that could match the same title | One group-level destination question; no automatic merge. |
| Photos with EXIF capture dates different from modification dates, a RAW/JPEG pair, and sidecars | Capture-calendar grouping, intact pairs, and clearly identified fallback for missing metadata. |
| A course folder containing video, PDF, and exercise files | Folder contents remain together and unchanged. Loose eligible files around it still organize. |
| Nested game data and a nested code project selected directly, including ordinary `.png` and `.txt` companions | Protected via ancestor context even when their immediate parent has no marker. |
| Unknown extension named `Example.S01E02.xyz`, partial downloads, and unrecognized files | Kept in place with understandable reasons. |
| One related member changes after review, or a target appears after review | No unverified source removal or overwritten destination; visible error/partial state as appropriate. |
| Apply, restart, inspect history, then undo | Verified effects recover correctly; edited outputs are not removed; user-created folders are retained. |
| Organize the same resulting folder again | No repeated nesting, renaming, or duplicate moves. |
| Destination mapping changed after preparing the plan, and an old apply request arrives | Stale revision rejected before writes. |
| Arabic/English filenames, redirected known folders, case-only collisions, junction replacement, and a missing external drive | Names preserved, canonical destinations respected, and ambiguous/unsafe operations held back. |
| Legacy plan/history/setup loaded after the change | Still inspectable and compatible where supported; no unintended watcher activation. |

UI gate: source selection starts preparation; no mandatory template, separate Build review, per-file checklist, or duplicate apply dialog for the new primary route. An ordinary mixed-folder case needs one source choice and one apply action, plus any actual ambiguity resolution. An empty or already organized location should say so without proposing busywork.

Run meaningful unit/integration checks and Electron UI tests covering the flow, actual resulting files, and undo. Run the existing regression suite once changes settle. Inspect real screenshots at the supported 1120x720 minimum window and normal size. Refresh screenshots only from passing synthetic flows.

Record cold/warm preparation time and peak memory for synthetic 10,000-file and 100,000-file inventories (the larger one may use resumable sections), plus UI responsiveness/cancellation. Targets: progress feedback within one second of starting; navigation remains responsive; cancellation is observed between bounded units. These are targets to verify on a recorded machine, not universal promises. Do not pretend copy duration is independent of disk speed or file size.

### Completion report for O1

Report the shipped behavior, source revision, tests, measured size/performance, actual limitations, and one representative before/after example. Update README, architecture, demo, and screenshots to the implemented scope. Preserve the other toolbox actions. Provide the user with release instructions only after the source state/version/notes are consistent; do not run or publish the release. Document later work instead of showing placeholder feature buttons.

## Later tasks — implement separately

| Task | User outcome | Dependency and scope |
| --- | --- | --- |
| O2: Better document and media evidence | Group supported documents by recognizable content; suggest existing libraries more accurately. | Reuse bounded local extraction/OCR. Add inspectable evidence and explicit correction examples. Arabic OCR support requires a model/quality decision. Optional AI adds topic/visual suggestions in the same flow and never controls the executor. |
| O3: Remember filing choices | A repeated collection goes to the destination the user taught Relay. | Extend O1's explicit root mappings into narrow, editable rules with scope, examples, priority/conflict handling, disable/delete, and no automatic broad generalization. |
| O4: Keep this location tidy | Familiar completed arrivals follow approved rules; uncertain arrivals wait in place. | Durable arrival records, stable-file handling, output-loop prevention, restart reconciliation, per-folder pause, and journal reuse. Current graph watcher queues are not durable, and scheduled organizer reviews do not already execute automatically. |
| O5: Whole collection moves | A personal course/project bundle can be relocated intact when explicitly chosen. | New directory manifest/identity checks, safe cross-volume copies, incomplete-group recovery, and guarded undo. App/game data remains protected; no blanket override. |
| O6: Large-library and disk overview | Find scattered personal collections and organize chosen areas efficiently. | Incremental scoped inventory, external-drive state, content search, and optional virtual collections. Physical organization remains available. No forced import into a private storage layout. |

These tasks are the path toward the stronger organizer the user described. O1 is a concrete improvement, not a claim that the full system is done.

## References checked

- [EasyTidy repository and component-license note](https://github.com/EasyTidy/EasyTidy), [MIT license](https://github.com/EasyTidy/EasyTidy/blob/main/LICENSE).
- [organize repository](https://github.com/tfeldmann/organize), [MIT license](https://github.com/tfeldmann/organize/blob/main/LICENSE.txt).
- [TagStudio repository](https://github.com/TagStudioDev/TagStudio), [project dependencies/license](https://github.com/TagStudioDev/TagStudio/blob/main/pyproject.toml), [GPL license](https://github.com/TagStudioDev/TagStudio/blob/main/LICENSE).
- [Paperless-ngx usage](https://docs.paperless-ngx.com/usage/), [GPL license](https://github.com/paperless-ngx/paperless-ngx/blob/dev/LICENSE), [setup source](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/setup.md).
- [Hazel folders and rules](https://www.noodlesoft.com/manual/hazel/hazel-basics/about-folders-rules/), [vendor license information](https://www.noodlesoft.com/kb/what-are-the-different-types-of-hazel-licenses/).
- [File Juggler documentation](https://www.filejuggler.com/documentation/), [vendor EULA](https://www.filejuggler.com/media/le0hyw3l/file-juggler-end-user-license-agreement.pdf).
- [FileBot features](https://www.filebot.net/), [current EULA](https://www.filebot.net/eula.html).
- [EasyTidy Pro visual-review behavior](https://docs.easytidy.net/guide/visual-review/) informs the distinction between useful correction learning and surprising pre-review file moves. Relay's pending items stay in their original location.

At implementation time, recheck the exact revision/license of any component actually selected for reuse. No hands-on comparative benchmark or combined installer was performed for this planning decision.
