# Implementation scope

## Working features

- Recursive collection scans, exclusions, project preservation, bounded traversal, saved inventories, and cancellation.
- Persisted versioned plans, collision detection, item selection, generated-content preview, execution confirmation, and guarded batch undo.
- General mixed-folder organization with No AI and With AI modes, internal or external placement, episode/subtitle grouping, photo filename families, group selection, partial drive reviews, scan continuation, and removal of empty folders created by an undone batch.
- Broad collection goals for combining folders into a library, reviewing duplicate and old large files together, preparing a delivery with private-name flags, and scheduling repeat reviews.
- Nine no-AI templates: drive organization, downloads cleanup, renaming, storage review, exact duplicate review, photo capture-date filing, age-based archiving, delivery manifests, and backup comparison.
- Seven AI templates: document filing, receipt records, meeting actions, research reading notes, screenshot filing, named-topic grouping, and filing advice.
- Local text/PDF/DOCX extraction and bundled English OCR; model-request and text budgets, result validation, confidence gates, cancellation, and bounded caching.
- Reusable folder setups and persistent schedules that prepare reviews while the desktop app is open. One missed-run catch-up; no unattended file modifications or AI calls.
- Visual graph workflows, file watching, portable graph recipes, and an optional self-hosted workspace API.

## Boundaries

- **Collection composition:** templates use dedicated forms and a shared plan contract. Arbitrary collection nodes on the graph canvas need a separate schema and editor design.
- **Project archives:** detected code projects stay together and are excluded. The archive template moves/copies old files; it does not compress projects or promise restorable project snapshots.
- **Backups:** verification compares hashes and repairs missing files. It does not replace versioned backups, retention policies, or disaster-recovery tooling.
- **AI grouping:** users supply allowed categories or project names. The model is not an unrestricted clustering or filesystem agent. Screenshots are classified from OCR text, not visual image understanding.
- **General AI mode:** supported documents receive text-based topic and name suggestions. Photos use names, dates, and local thumbnail comparison. Image-subject understanding would require a vision-capable connection and dedicated validation.
- **Large scans:** section state is saved so pending directories can be continued, but each section is still held in memory and the app does not yet have a fully disk-backed, paged inventory. Very large individual directories can exceed section targets.
- **Remote workers:** the API stores accounts, graph recipes, share links, and run summaries. It does not dispatch desktop jobs, sync collection journals, or grant remote disk access.
- **Background execution:** schedules require the open desktop app. A Windows service would need worker ownership, authenticated dispatch, durable queues, permission management, and a separate review interface.
- **Recovery:** filesystem effects and SQLite cannot commit atomically. Uncertain crash states require inspection; the executor does not guess ownership or promise exactly-once delivery.

## Possible extensions

Image-subject understanding, a disk-backed paged inventory, multi-language OCR, whole-project archive verification, collection graph composition, authenticated desktop worker dispatch, and versioned backup policies. Each needs its own design and tests.
