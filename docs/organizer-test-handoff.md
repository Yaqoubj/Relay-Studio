# Organizer validation record

Implementation date: September 26, 2026. Source baseline: `25588d7`. Package target: **1.6.0**.

The owner authorized implementation of O1–O6 and a general UI redesign. The owner runs the release; source validation and upload are authorized. This record documents the checks completed for version **1.6.0**. No installer, Git tag, or release was created.

The production build and TypeScript check pass. `npm.cmd test` passes **58 tests**. `npm.cmd run test:e2e` passes **7 Electron tests**. Those tests use disposable synthetic files and isolated application data. Screenshots were refreshed from the running desktop app. GitHub prose describes the current app directly. **Do not execute the release script, publish a release/tag, or build an installer.**

## Implemented areas

| Task | Source implementation                                                                                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1   | `organize-location.ts` prepares direct grouped reviews; `LocationManager` owns version/revision/grants; primary GUI uses collection cards, optional details, destinations, apply, and guarded undo.         |
| O2   | Bounded local extraction, SHA-256-keyed evidence cache, narrow two-signal topics, snippet/reason display, optional allowlisted model hints, EXIF/companion evidence.                                        |
| O3   | Exact source/collection filing choices, stored examples and root identity, priority conflicts, enable/edit/delete, revision invalidation.                                                                   |
| O4   | Durable arrivals, first-enable baseline, stable-file wait, restart reconciliation, rule-only execution, cross-location loop checks, per-location pause, undo suppression.                                   |
| O5   | Explicit immediate personal-folder manifests, file hashes and directory identity, new collection destinations, exclusive cross-volume copy/removal, empty folders, directory journals and guarded recovery. |
| O6   | Scoped SQLite index, incremental extraction reuse, section continuation, generation-based deletion, offline/root-replacement state, paged literal search, saved virtual searches.                           |

General UI: prominent organizer launchpad on Home, category filters, revised shell/navigation palette, dedicated Organize/Library/Filing choices/Activity tabs, collection samples and destination tree, and Advanced entry to retained specialized tools. Version label is generated from package metadata rather than a stale hardcoded number.

No new dependencies, competitor code, models, or runtimes were added. The ordinary flow preserves existing folders. Code-project/application/game trees stay protected, including explicit bundle relocation. Whole-folder moves support eligible personal collections, not arbitrary protected projects.

## Validation performed

`npm.cmd run build` includes `tsc --noEmit`, Vite, and Electron main-process bundling. `npm.cmd test` exercises the unit and service suite. `npm.cmd run test:e2e` rebuilds and runs the Electron suite. The first desktop run exposed two stale assertions; both were updated to match the new UI and the full suite then passed.

Run:

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run test:e2e
```

The new primary desktop flow is covered for grouping an episode and subtitle, choosing an existing season folder, applying and undoing the move, indexing a synthetic location, and searching extracted text. The suite also covers retained specialized flows and watcher persistence. It does not exhaust every edge case listed below. Do not test against real Downloads, games, saves, libraries, or disks. Use synthetic files and an isolated `RELAY_DATA_DIR`.

### Existing fixture changes that are necessary

The new policy checks **all ancestors**. Unit fixtures under `process.cwd()` now belong to this Git/code project and should be rejected. Windows `os.tmpdir()` is commonly under AppData, which is also protected. Move mutation/scanner fixtures into a disposable personal root outside those trees, such as a dedicated temporary directory under Documents, or use injected filesystem trees for pure policy tests. Do not add a production bypass, shallower ancestor limit, or test-mode permission exemption.

Inspect at least `organizer.test.ts`, `smart-organizer.test.ts`, `collections.test.ts`, `file-policy.test.ts`, `engine.test.ts`, `batch.test.ts`, and affected `studio.spec.ts` fixtures. Existing toolbox/server fixtures that do not mutate protected inputs need not be relocated solely for convenience. Verify every cleanup target stays inside its own disposable root before removing it.

Legacy Electron organizer tests currently enter File organizer and expect template/setup forms. They must explicitly enter **Advanced tools** after File organizer. Preserve those regression tests and add separate tests for the new primary flow. Do not rewrite tests to accept accidental missing behavior. The workflow-guide label also changed.

## Additional hardening coverage

The following cases remain useful for deeper follow-up; passing the current suite does not imply each has been simulated individually.

### Primary preparation and apply

- Selecting a native source starts preparation, with actual progress and cancellation, and no separate Scan/Build buttons.
- Three episodes and language subtitles reuse an existing matching season folder. Original names/content remain. Unknown `S01E02.xyz` stays untouched.
- Two candidate series folders, conflicting remembered destinations, and missing external roots produce a group-level decision, no fallback move.
- Use real EXIF fixtures with capture date different from modification time. RAW/JPEG/XMP/AAE pairs stay together. Missing/conflicting dates and fewer than three stems do not invent event folders.
- Preserve a personal course folder during ordinary organization while organizing surrounding loose files. Select deeply nested project/game data directly and ensure ancestor protection applies. Verify `.relay-preserve`, hard links, junction replacement, incomplete downloads, and Arabic/English filenames.
- Change a source or create a destination after review: preflight must prevent unsafe initial writes. Mutations during a later copy must never cause unverified source deletion or overwrite.
- Reject a stale ID/revision after choice/rule changes. Send a partial related-set selection or forged root reference directly to the main/service boundary and verify rejection.
- Apply, restart, load the journal, and undo. Edited output and occupied original paths must stop undo. Newly created user folders remain. Run-created empty folders can be removed. Re-running the resulting location should not nest or rename it again.
- Counts in cards, the arrangement, completion, details, and the executor agree after keep/change/include actions. New/source-changed preparation failures must not display an old plan as belonging to the newly selected source.

### Evidence and choices

- Inject text extraction and model responses; verify two local signals, ambiguity fallback, request limits, invalid JSON/confidence/topic rejection, and source hash revalidation.
- Cache identity uses source hash and OCR mode, not just timestamps. Changing source contents invalidates evidence.
- Save current/internal and explicit external destinations, reopen the app, and verify scoped reuse. Different source/collection must not inherit the choice.
- Rule priority, equal conflicts, disabling, deletion, and root replacement behave visibly. Editing a rule should not silently apply an older displayed revision.
- OCR is visibly English-only. Embedded Arabic text can be handled independently of OCR. AI is never called by automatic filing.

### Automatic filing

- First enable leaves existing source files pending. A later arrival follows an approved rule only after its stamp has been stable at least 10 seconds.
- One unstable related member holds its whole related set. Unknown/uncertain/colliding arrivals remain in their original location.
- Restart handles durable waiting/pending records; claimed interrupted batches are not replayed. Reconcile files changed while the app was closed.
- Outputs are not reprocessed. Reject cross-location rule chains into other active source roots. Rule edits cannot introduce such a loop.
- Undo pauses its source and marks restored tracked arrivals pending. It must not immediately reverse the undo through automatic filing.
- Disconnect/replace a source/library or induce copy failure; pause that location and retain inspectable partial effects. Other locations should remain usable.
- More than 10,000 loose files pauses automatic filing with a clear reason. Cancel must not multiply file changes. Existing graph watcher behavior and scheduled-review semantics remain compatible.

### Whole-folder moves

- Eligible personal course with nested files and empty directories moves intact to a new collection folder. Verify exact bytes, relative paths, original names, removal of only verified empty source directories, restart, and undo.
- Reject an existing collection destination even if individual filenames do not collide. Reject source/destination overlap, symlinks/hard links, game/app/code markers, unfinished files, and excessive manifests.
- Add/remove/edit a member or replace a directory after review; preflight must reject before initial writes. Add a file during copying; no recursive source deletion is allowed.
- Inject copy/removal failures and crash-window file/directory states. Inspect partial journals and supported undo. Never claim group atomicity or guess ownership.
- Validate every manifest path under its bundle/source and destination root. Test a real cross-volume fixture if available; otherwise simulate copy failures and record that real cross-volume behavior remains unverified.

### Library

- Index, search, page, save/delete a query, refresh changed files, and retain unchanged extracted text. Refreshes should eventually attempt documents previously held by the 100-document content budget.
- Complete traversal removes missing rows; partial/cancelled traversal must not purge unseen files. Continue saved pending directory sections and verify generation semantics.
- Disconnect an external-root fixture, retain cached search, reject open/organize while offline, and detect replacement at the same path.
- Remove index deletes metadata only. Saved searches do not move/import files. Escape `%`, `_`, and backslashes as literal searches. Keep scope boundaries and grants for open/index/organize.

## Performance and visuals

No 10,000- or 100,000-file benchmark was run. Record machine/OS/runtime, cold and warm preparation time, peak memory, progress latency, UI responsiveness, and cancellation before making performance claims. Direct organization prepares up to 5,000 loose files, while Library sections cover broader inventories; report which stage is measured. Directory context stops at 2,000 folders/four levels. These are limits, not throughput measurements.

Review native image decoding, synchronous SQLite work during arrival reconciliation/index updates, and history/state loading under large data. Profile before moving work into a worker. No bundled-size delta or new performance result has been measured. There are no added dependency/runtime weights; compare actual built source artifacts and record the eventual packaged measurement separately during the owner's release checks.

Screenshots were captured from synthetic desktop flows at the normal 1480×960 viewport and a compact 1120×720 viewport. The suite verifies Home/toolbox, organizer grouping and completion, and library search. A full manual visual audit of Arabic paths, error/cancel states, and every narrow-layout interaction remains useful.

The refreshed PNGs are produced by passing synthetic flows with `RELAY_UPDATE_SCREENSHOTS=1`. They are linked from README/demo and include Home, organizer collections/completion, and library search. Remembered-choice and whole-folder screenshots are not part of this capture set.

After checks settle, run regressions once more only if fixes require it. Update README/architecture/demo/roadmap/release notes to verified behavior; remove provisional validation notes only when their gates actually pass. Keep limitations and measurements honest.

## Source upload and owner release

Commit all intended source/docs/screenshot changes and push the source when validation passes. Leave ignored private guides ignored. No unrelated files or generated build output should be committed. Review the final Git diff before upload.

The owner can then run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Publish
```

The script requires a clean committed/pushed checkout, runs tests/build/packaging/smoke checks, verifies assets, and publishes. It has **not** been executed here. Do not create a release, tag, draft, or installer on the owner's behalf. Update the release notes around verified current behavior, without a long comparison with earlier versions.
