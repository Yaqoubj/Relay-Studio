# Implementation scope

## Implemented and source-validated

- Primary collection-card organizer with automatic preparation, existing destination matching, original filenames, related sets, revision checks, and one apply action.
- Episodes/subtitles, photo capture dates and sidecars, local document clues, optional constrained AI, and inspectable evidence.
- Exact scoped filing choices with examples, destination identity, priority conflicts, editing, disabling, and deletion.
- Durable stable-arrival monitoring, first-enable baseline, pending uncertain files, restart reconciliation, output-loop checks, per-location pause, and shared file journals.
- Explicit personal whole-folder manifests, verified cross-volume copy/removal, empty-folder handling, and guarded undo. Application/game/code trees remain protected.
- Scoped SQLite library indexes, incremental content reuse, section continuation, offline state, paged search, and saved searches.
- Desktop Home/organizer/navigation redesign; picture/PDF/text toolbox and advanced graph/specialized tools retained.

The production build, 58 unit tests, and 7 Electron end-to-end tests pass. See [validation and screenshots](organizer-test-handoff.md). Large-library performance and packaged size have not been measured. Installer publication and tags belong to the owner.

## Deliberate boundaries

Ordinary organization handles loose files without dismantling existing folders. Whole-folder relocation is an explicit action. Local content classification covers a small set of supported document topics; it does not understand every collection. Photo grouping uses metadata, not image subjects. OCR uses English data.

Automatic filing needs approved remembered rules and an open app. It does not run paid AI unattended, relocate bundles, silently retry interrupted claims, or operate as a Windows service. Graph watchers and scheduled review templates have separate documented behavior.

The library is a searchable snapshot, not a live exhaustive filesystem catalog. Section scans still use bounded in-memory inventories. Search is literal text matching rather than semantic retrieval. Index removal never deletes originals.

SQLite and filesystem effects are not one atomic transaction. Unknown crash states require inspection. Verified undo is not disaster recovery. File actions do not promise preservation of every platform-specific attribute.

## Further work

Arabic OCR after a separate model/quality decision, image-subject recognition, ranked full-text search, fully streaming inventories, authenticated remote desktop workers, Windows service execution, and versioned backups need separate designs. No placeholder buttons represent these features as available.
