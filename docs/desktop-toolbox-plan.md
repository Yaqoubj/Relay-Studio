# Relay desktop toolbox: product and implementation plan

Status: implementation started, September 24, 2026. The first desktop toolbox slice is in the app; the complete inventory and later waves below remain a plan. This document does not authorize a release.

Implemented so far: Home, All tools, Activity for finished results, eight image/PDF/text actions, picker/drop input, and an additional protection check for recognized game/application/project data. Smart organization keeps names by default. The older file organizer and workflow editor remain available. Durable toolbox jobs, background workers, desktop capture/clipboard tools, media tools, and remote workers are not implemented yet.

## 1. The product

Relay becomes an everyday Windows desktop toolbox. People open it, choose a visible tool or drop something into it, and get a useful result. It helps with pictures, documents, clipboard content, screenshots, media, files, and repeated desktop tasks.

The normal experience requires no commands, scripts, prompts, API keys, accounts, server setup, or workflow diagrams. Search means finding a tool by name, such as "PDF" or "smaller pictures". It is optional. Every action is also accessible with a mouse.

The main promise: **finish common desktop tasks with fewer steps, and reuse the steps when the task repeats.**

The distinguishing work will be the consistent experience across tools: useful defaults, batch input, direct result previews, predictable output locations, saved preferences, a shared history, and routines built from actions people already understand. A large tool count alone is not a reason to use the app.

Windows is the first supported platform. Retain Electron, React, TypeScript, and SQLite unless implementation evidence establishes a specific reason to replace them. Keep Relay as the working name; branding is not a prerequisite for this redesign.

## 2. What the user sees

### Home

- A prominent area: **Drop files here**, with **Choose files**, **Choose folder**, and **Paste** buttons. Paste happens only when requested; opening Home does not read clipboard contents.
- Six visible favorite/recommended tool cards. New installations show Make pictures smaller, Create a PDF, Get text from an image, Tidy Downloads, Clean pasted text, and Compare folders.
- Recent results with Open, Show in folder, Copy, and Run again where appropriate.
- A small indication when a task is running, with progress and a Cancel button.
- A link to Browse all tools. Tools that are not implemented are not displayed as working buttons.

### Toolbox

Categories: Capture; Clipboard & text; Images; PDFs & documents; Video & audio; Files & storage; Desktop.

Each card has an ordinary verb, a one-sentence result, and an example when useful. "Make pictures smaller" is more useful than "Image processing pipeline". Users can favorite tools. Optional search matches common phrases without calling a model.

### Routines

Saved combinations of tools, presented as readable steps. "Prepare pictures to send" can show Resize pictures, Remove location information, and Save copies. A new routine is built with Add step and compatible tool choices. The graph canvas is available through an Advanced link for existing power users.

### Activity

Running tasks, completed results, items needing attention, and history. Ordinary results show what was produced and where it is. Technical logs are expandable. An Undo button appears only when supported, with a clear explanation if a result has changed since the task ran.

### Settings

Output defaults, appearance, accessibility, optional background behavior, privacy, and optional model connections. Existing workspace/server connections move here. They are not part of first launch.

### Quick access

Tray actions and an optional configurable keyboard shortcut open a compact version of Home. This is a secondary entry point; the full app remains the primary experience. Explorer integration may follow once file selection and access grants are reliable. No global shortcut is required to use a tool.

## 3. Interaction rules

1. **A useful default first.** Tools start ready to run where possible. Optional controls live under More options. Remember deliberate preferences per tool rather than silently changing behavior based on guesses.
2. **Ask only for information that changes the result.** Splitting a PDF needs page choices; compressing a picture can use a default. Never ask for a destination folder if a safe output beside the originals will do.
3. **Choose input once.** Carry dropped or selected files into the tool. Offer relevant actions based on supported input types, not on speculative AI classification.
4. **Batch by default.** Multiple inputs become one task with per-item progress and a single result summary. Mixed unsupported input is explained and skipped only with a clear count.
5. **Preview matches the content.** Use thumbnails, page thumbnails, a video scrubber, or before/after text. Do not use an enormous filename table as the universal interface.
6. **Low-impact actions run directly.** Creating new copies and cleaning explicitly pasted text need no repeated confirmation. Changes to existing paths show one concise outcome summary; raw file details remain available.
7. **Originals are preserved for transformations.** Compression, conversion, trimming, and document editing produce new files. Filename changes happen in the explicit Rename tool, not as a hidden side effect of tidying.
8. **Long tasks do not freeze the app.** Users can browse tools, see real progress, cancel, and retrieve completed outputs. A queued task must be visibly queued, not apparently stuck.
9. **Explain failure in ordinary language.** State which item failed, what finished, and the useful next action. Logs and diagnostic details are optional.
10. **No automatic upload.** Local tools work locally. An action that sends content to a model or another device identifies that destination before first use and whenever the destination changes.

Default file output is a descriptive result folder beside the selected input, such as `Relay Results/Smaller pictures`. Use collision-safe output names without replacing existing files. A batch from several input folders asks for one output location or uses the user's previously chosen results folder. The result screen always offers Show in folder.

Being allowed to read a dropped file does not automatically grant writes to its parent directory. If that output location is not writable or not granted, offer the standard results folder and request access only when necessary. Preserve supported metadata during ordinary transformations where possible; disclose format-related losses. Deliberate metadata removal is its own action.

Do not turn successful result notifications into approval dialogs. Do not show duplicate in-app and native confirmation dialogs for the same choice.

## 4. Planned tool inventory

"Existing base" means useful underlying code exists, not that the proposed experience or output format already works. Delivery waves are defined in section 13.

| Tool | Normal user experience | Existing base | Wave |
| --- | --- | --- | --- |
| Make pictures smaller | Drop pictures; use a balanced preset; see dimensions and total size saved; get copies | Image decoding/comparison exists; transformation service is new | 1 |
| Resize pictures | Choose Small, Medium, Large, or custom dimensions; preserve proportions | New | 1 |
| Convert pictures | Choose JPG, PNG, or WebP; preserve originals and explain transparency changes | New; available decoders need format verification | 1 |
| Create a PDF from pictures | Drop images, drag thumbnails into order, save one PDF | New PDF writing capability | 1 |
| Merge PDFs | Drop PDFs, reorder them, save one document | Existing PDF reader; editing/writing is new | 1 |
| Extract PDF pages | Select page thumbnails or a simple range; save selected pages | Existing PDF reader; editing/writing is new | 1 |
| Get text from an image or PDF | Drop a file, read/correct the text, copy or save it | Existing document extraction and English OCR | 1 |
| Clean pasted text | Paste; remove broken line wraps, extra spaces, or duplicate lines; see the change | New, small local transforms | 1 |
| Tidy loose files | Choose a familiar location; see grouped outcomes; apply approved moves | Existing organizer needs a new protection policy and UX | 1 |
| Rename selected files | Choose a simple pattern; see representative before/after names; apply once | Existing rename logic; protections and UX need revision | 1 |
| Find exact duplicates | Choose personal folders; compare groups; move selected extras to a recovery location | Existing hashes and verification; policy needs revision | 1 |
| Compare or verify folders | Choose original and backup once; see Matches, Missing, and Different; copy missing files on request | Existing backup comparison | 1 |
| Screenshot and annotation | Capture a selected area; draw, crop, blur, copy, or save | New capture/editor integration | 2 |
| Copy text from the screen | Select an area; get editable text | Existing OCR plus new capture integration | 2 |
| Clipboard history | Opt in; recover a copied item; search, pin, paste as plain text, or delete | New native integration and storage | 2 |
| Saved text snippets | Click a saved address/reply/template to copy or paste it | New | 2 |
| Pin an image for reference | Keep a small image window visible while using another app | New | 2 |
| Pick a screen color | Select a point and copy its color value | New | 2 |
| Reopen a workspace | Save and reopen a set of applications, folders, and websites | New; does not restore unsaved app state | 2 |
| Keep the computer awake | Select a duration; show an obvious timer and Stop control | New native adapter | 2 |
| Find files and document text | Search explicitly selected personal folders, with snippets and Open result | Extraction can be reused; indexing is new | 2 |
| Calculate and convert units | Enter ordinary values in a visible calculator/converter | New; deterministic local tool | 2 |
| Crop and watermark pictures | Make changes on a visual preview; apply to one or a batch | New | 3 |
| Remove picture metadata | Create copies without supported metadata and verify the result | EXIF reading exists; removal/writing is new | 3 |
| Rotate and reorder PDF pages | Drag and rotate page thumbnails, then save a copy | Extends Wave 1 PDF service | 3 |
| Create a searchable scanned PDF | Keep the page image and add aligned selectable text | Existing OCR is insufficient alone; layout/writing work is new | 3 |
| Compress a video | Pick a practical preset and preview a sample; export a smaller copy when possible | New media worker | 3 |
| Trim a recording | Choose start/end visually; export the selection | New media worker | 3 |
| Extract or convert audio | Drop a supported recording and choose the needed output | New media worker | 3 |
| Make a GIF | Select a short section and size; preview before saving | New media worker | 3 |
| Transcribe speech | Select a recording; choose an installed local model or connected provider; get editable text | New transcription capability | 3 |
| Translate, rewrite, or summarize | Select text or supported content; use a connected model; inspect the result | Existing provider adapter and extraction can be reused | 3 |
| Prepare files to share | Combine compatible tools into smaller copies, then optionally package them | Existing delivery copy; compression/packaging is new | 4 |
| Repeat a routine | Run named steps manually, on a schedule, or on arrivals in one selected folder | Existing graphs/watchers/schedules are partial foundations | 4 |
| Send to another device | Pair devices explicitly; send selected files or text; see transfer progress | New transport, pairing, and receiver | 5 |
| Process on my other PC | Send an approved job to a paired machine; retrieve the output | New authenticated worker system | 5 |

The first release includes useful breadth across images, PDFs, text, and files. Later waves add more tools, not placeholder cards promising features that are unavailable.

Format and quality boundaries must be visible. A converter does not guarantee every codec or document variant. Extra formats such as HEIC require a tested decoder and packaging decision. PDF merging/extraction can start with ordinary unencrypted documents; encrypted or unsupported documents get a clear explanation. Compression must report when the output is not smaller, not claim success by size alone.

OCR is itself model-based, but the bundled local OCR does not require a generative-AI account. The current implementation supports English. Additional OCR languages, including Arabic, require explicit model packaging, quality evaluation, and a visible download/installation flow. Do not label English-only OCR as multilingual.

## 5. Concrete user journeys

### A. Send a batch of pictures

1. Drop 20 pictures on Home.
2. Click Make pictures smaller. The default is a balanced quality/size preset with aspect ratio preserved.
3. Relay creates copies and shows a contact sheet, total input/output size, and Open folder / Copy files.
4. An optional control changes size or quality; there is no destination or naming wizard.

If the output would be larger, preserve the original as the better result or mark that item as not reduced. Do not upscale by default. Preserve orientation. When converting transparent images to JPG, show the chosen background.

### B. Make one PDF for an application

1. Choose Create a PDF and drop scanned images.
2. Drag thumbnails into order; rotate a page if needed.
3. Click Create PDF and get Open / Show in folder.

No workflow setup. PDF size optimization can be an option with an honest preview, not a guaranteed arbitrary file-size target.

### C. Recover something copied earlier

1. Enable clipboard history once with a plain explanation of what will be stored.
2. Open Clipboard from the app or optional shortcut.
3. Click the earlier item and choose Copy or Paste.

History can be paused, cleared, limited by age/size, and disabled for selected applications. Sensitive-format suppression helps but is not a promise to detect every secret. Clipboard history and snippets remain local unless a specific later sharing action is invoked.

### D. Tidy Downloads

1. Click Tidy Downloads. Relay resolves the actual Windows known folder; it does not assume a fixed English path.
2. Scan and planning happen together. Show cards such as Pictures, PDFs, and Video sets with sample thumbnails, counts, destinations, and Skipped items.
3. Click Tidy files once. The full item list is available through Details.
4. Show a short completion summary and supported Undo.

Default behavior covers eligible loose personal files. Keep filenames, existing folder bundles, and application/game data intact. Users can choose a broader personal collection explicitly; selecting a whole drive is not authorization to restructure every directory on it.

### E. Repeat something useful

1. After using compatible tools, choose Save as routine.
2. Give it a name. Show a short step list and a sample result.
3. Manual Run is immediately available.
4. Later, the user can explicitly enable When files arrive for one chosen folder or a schedule.

Enabling a routine records its scope, output location, actions, and model destination if relevant. A materially changed routine needs its automatic behavior reviewed again. Routine creation never enables background execution implicitly.

## 6. Shared handling of files and application data

This is a foundation requirement, not a separate user-facing checklist. The user should not have to identify every dangerous file manually.

The current code has generic system/development folder protections, but no complete game-save or application-data model. The organizer, duplicate/cleanup tools, and graph workflows do not all enforce the same protection. A normal unknown `.sav` file is initially deselected by the smart organizer, but that does not protect every save format, companion file, episode-like name, or execution path.

Planned policy:

- Centralize source and destination checks for every action, including advanced workflows and background routines.
- Recognize Windows known folders, known game/save roots, installed/portable application evidence, project markers, companion files, and containing-folder context. Evaluate ancestors as well as the immediate selected directory.
- Preserve application-owned and uncertain bundles. Extension alone cannot establish that a file is independently movable or disposable.
- Use positive eligibility for automatic changes: an approved personal location, supported standalone content, and an action whose effect is understood. Unknown content remains untouched and receives a short reason.
- General tidying preserves original filenames. The episode classifier must only operate on supported media and validated companions, never an unknown file that merely has `S01E01` in its name.
- Duplicate hashes establish equal bytes, not permission to remove one copy. Do not remove application dependencies just because another file has matching content.
- Whole-disk inspection may report storage and candidate personal collections. Automated whole-disk reorganization is not a default action.
- Conflicts are skipped or handled by an explicitly chosen naming strategy. Never replace an existing file silently.
- Undo checks identities, output ownership, and whether files changed. It must explain when restoration cannot safely proceed. Game-save corruption is not automatically recoverable merely because an Undo button exists.

Known-path detection will never recognize every application. Conservative action eligibility is necessary alongside the recognition rules. This is how the app can ask fewer questions without guessing more aggressively.

Protection depends on the effect: reading an explicitly selected image or copying an explicitly chosen folder with its structure intact is different from reorganizing its contents. Allow appropriate read/copy tasks without granting permission to rename, split, move, or delete application data. A copy of active application files is not advertised as a consistent, restorable application backup without application-specific support.

## 7. Defaults for review and execution

| Action type | Default interaction |
| --- | --- |
| Copy text, calculate, convert units | Immediate result after explicit input |
| Produce new image/PDF/media copies | Run with a useful preset; show progress and results |
| Visual edit | Show the image/pages/timeline being edited; Save produces a copy |
| Move or rename existing personal files | One grouped outcome summary, then Apply; detailed paths optional |
| Select duplicate copies to remove from active folders | Keep a visible keeper; move extras to a documented recovery location after approval |
| Repeat an approved narrow routine | Run within saved scope; isolate unexpected items for attention |
| Permanently remove data or broaden scope | Explicit, specific choice; no silent escalation from a harmless preset |

The default product does not advertise blanket "undo everything". Creating copies, copying text, sending files, calling a model, and reopening applications have different recovery behavior. Each tool declares what can be undone and what remains after cancellation.

## 8. What stays, changes, and leaves the main experience

| Current part | Decision |
| --- | --- |
| Electron app, React UI, TypeScript | Keep; rebuild navigation and tool flows incrementally |
| Sandboxed preload bridge and local folder grants | Keep; extend to explicit dropped/selected inputs and validate in the main process |
| SQLite records, copy verification, collision checks, guarded undo | Keep and adapt behind shared services |
| PDF/DOCX/text reading and local OCR | Keep as services; separate extraction from editing or searchable-PDF generation |
| Organizer and collection analyzers | Keep proven algorithms; replace default policies and review flow |
| Duplicate and backup comparison | Keep, with clearer limits and shared application-data protection |
| AI provider adapter and encrypted credential handling | Keep optional, behind Settings and relevant actions |
| Graph engine | Preserve existing workflows through an adapter; expose the editor under Advanced |
| Folder watching and saved review schedules | Keep compatible behavior initially; migrate explicitly when durable routines are ready |
| Optional workspace API | Keep compatible accounts/sync; do not describe it as a job worker |
| Current template-heavy home and AI/non-AI task duplication | Replace with one tool catalog and optional capabilities inside each tool |
| Mandatory long file tables and repeated confirmations | Replace with content previews, concise summaries, and exception details |
| Repeated AI report templates | Move useful extraction/summarization under document actions; remove redundant entry points from the main navigation |

Existing user data, history, grants, workflows, and credentials must survive the redesign. Old workflows must be revalidated under the shared policy; importing or migrating an old definition must not bypass it. Do not silently resume a previously paused watcher after upgrading.

## 9. Proposed internal architecture

The new app needs a shared action/job service. The old graph engine is not the universal runtime: it currently processes individual inputs with a 25 MB limit and restrictive graph semantics, which do not suit large videos or multi-document editing.

```text
Home / Toolbox / Quick access / Routines
                  |
           Validated desktop bridge
                  |
          Action catalog and job service
           /          |             \
  File policies   Durable records   Worker processes
  Access grants   Results / events  Image / PDF / OCR / media
           \          |             /
          Local filesystem and OS adapters
                  |
       Optional model-provider connection

Existing graph engine -> compatibility adapter -> shared policies/services
Future paired device -> authenticated dispatch -> same validated action contract
```

### Action contract

Each action has a stable ID and version, accepted input types, validated settings, defaults, effect type, preview type, output contract, cancellation behavior, recovery behavior, and allowed execution modes. Actions expose typed inputs/outputs so a routine can offer compatible next steps.

For example, Resize pictures accepts supported image inputs and produces image artifacts. Extract text produces text artifacts. The UI does not send raw shell commands or arbitrary execution paths.

### Job records

Persist the chosen action version, validated configuration, granted inputs, per-item status, outputs and ownership, progress, errors, and any effects needed for recovery. Suggested states: queued, running, cancelling, completed, partially completed, failed, cancelled, interrupted, and needs attention. These are implementation concepts, not a list of jargon to expose on every screen.

Events update the UI without repeatedly serializing large batches. Large inputs are streamed or processed in workers. Use small bounded concurrency for independent copy-producing tasks, serialize conflicting writes, and allow only a bounded number of CPU/GPU-heavy jobs. A second task can queue without blocking navigation.

### Recovery

Write new outputs to owned staging locations and finalize only after verification. Never infer ownership from a filename alone. Persist enough information to distinguish completed outputs from incomplete work. After a crash, mark uncertain file mutations for inspection; automatically resume only action stages whose restart behavior has been proven safe.

SQLite and filesystem mutations are not one atomic transaction. The design must acknowledge this, not claim exactly-once execution. Retry only failed eligible items, with source identity and output checks before effects occur again.

### Native adapters and dependencies

Capture, clipboard behavior, power management, app launching, and optional Explorer integration live behind Windows-specific adapters. PDF writing, media conversion, and speech recognition require new dependencies or worker executables. Audit their maintained APIs, licenses, codec/model availability, installation footprint, and packaged behavior before selection.

Keep rendering and heavy parsing outside the UI process. Native helpers receive validated argument lists and supported operations; no user-authored command strings are part of ordinary tool execution. Existing untracked build remnants are not evidence of a supported native integration.

### Implementation work packages

These are proposed module responsibilities, not files created by this plan:

| Work package | Responsibility | Depends on |
| --- | --- | --- |
| Shared action definitions | Stable tool IDs, settings schemas, supported input/output types, defaults, and effect declarations | Approved tool flows |
| Desktop action registry | Resolve only supported actions; validate inputs/settings; dispatch workers | Shared definitions and access policy |
| Shared file/access policy | Grants, protected context, source identity, destination checks, and action-specific eligibility | Wave 0 fixtures |
| Job store and runner | Durable jobs/items/artifacts, progress events, cancellation, retry and recovery | Registry, policy, database migration |
| Image/PDF/text actions | Actual tool implementations with independent correctness checks | Registry and worker contracts |
| Home and tool pages | Input selection, contextual actions, content previews, result controls | Action metadata and typed desktop bridge |
| Activity and recovery UI | Running jobs, outcomes, failed-item retry, guarded undo, diagnostics | Job store and progress events |
| Windows adapters | Capture, clipboard, power state, app launching, tray/shortcut behavior | Explicit capability boundaries |
| Routine adapter | Compose compatible actions and preserve old graph workflows | Stable action contracts and policy |
| Remote worker protocol | Pairing, transfer, supported job dispatch and revocation | Proven local jobs; Wave 5 only |

Use additive database migrations for new job, item, artifact, and routine records. Preserve old records separately until a tested adapter can read them. Schema changes need an application-data backup and a defined failed-migration recovery path. A worker output is registered as an artifact only after the action-specific completion checks succeed.

## 10. Automation and background behavior

Automation is an optional way to repeat the same visible tools. Start with manual routines, then named folder-arrival triggers and schedules. Do not begin with a marketplace or a general-purpose script runner.

- A routine's steps must agree on input/output types. Invalid combinations are not offered.
- Folder triggers wait for stable input, exclude their own outputs, avoid loops, and remember already handled items across restarts.
- Persist pending jobs. Reconcile interrupted work instead of replaying every trigger blindly.
- Missed schedules produce one appropriate catch-up run, not an unlimited backlog.
- Background automation uses the same permissions, protection rules, collision handling, and operation records as manual actions.
- Close-to-tray, run at sign-in, and notifications are opt-in settings with plain explanations. Quit stops desktop execution. An always-on Windows service is a separate later decision.
- Automatic AI steps remain disabled initially. A future opt-in needs an explicit provider, content scope, usage limits, and failure behavior.
- The existing schedule feature only prepares reviews while the app runs. That fact remains true until the new routine execution path is implemented and tested.

## 11. Optional AI and remote features

The core toolbox works offline without a model connection. Local OCR and local speech recognition may use installed models; explain downloads and hardware requirements in their own setup flows. Do not require model setup to merge PDFs, clean text, or resize images.

Connected AI assists with selected translation, rewriting, transcription, and document-understanding tasks. It returns inspectable results through existing validated providers. It does not decide unrestricted filesystem actions or bypass the action catalog. Cloud content transmission is explicit. No claim is made that a consumer chat subscription supplies an app API entitlement.

The backend becomes operationally necessary only for features that need it. Wave 5 proposes an authenticated receiver/worker on another machine, with revocable pairing, scoped actions, bounded storage, authenticated transfers, progress, integrity checks, and expiry. It must not expose arbitrary disk access or remote commands.

Start device handoff on a local network. Internet access, relay hosting, and remote-worker deployment need a separate transport design. The current workspace API provides recipe sync and run summaries; it does not already provide pairing, transfer, or remote execution. Heavy processing on the user's always-on PC is a valid later outcome, not a prerequisite for using the local toolbox.

## 12. Visual and accessibility requirements

- Use familiar tool cards, readable labels, clear empty states, and real previews.
- Home shows a manageable set of actions; the catalog carries the breadth.
- Show a result as a picture, document, text, or recording wherever possible.
- Give every icon-only control an accessible name. Support tab navigation, visible focus, screen readers, reduced motion, and high contrast.
- Support Windows scaling and smaller laptop screens without hiding primary controls.
- Preserve Unicode filenames and mixed Arabic/English content throughout. Test right-to-left content in text results and filenames. Full UI localization is a separate delivery decision.
- Do not silently infer success from an animation. Show completed/failed item counts and actionable results.
- Technical details such as API endpoints, queue workers, hashes, and codec arguments belong in Settings or expandable diagnostics, not the default task flow.

## 13. Delivery sequence and completion gates

No release dates are assigned before the native and document-processing spikes establish their constraints. A wave is finished when its user outcomes and packaged checks work, not when its buttons exist.

### Wave 0 — Protection and migration foundation

Tasks: shared file policy, current-path audit, saved-data migration plan, regression fixtures for application/game folders, and a clear compatibility strategy for advanced workflows.

Gate: organizer, cleanup, graph execution, and scheduled paths cannot bypass the new policy. Existing safe workflows and histories remain usable. The source and tests explain exactly what is protected and what remains uncertain.

### Wave 1 — First useful toolbox release

Tasks: new Home/Toolbox/Activity/Settings, action catalog, shared job/result service, input handoff, and all Wave 1 tools in the inventory. Start implementation with one complete image action to prove the new flow, then add the document/text/file actions using the same contract.

Gate: an ordinary user can complete image compression, picture-to-PDF, PDF merge/extraction, OCR text extraction, and a file task using visible controls without entering settings or the graph editor. Packaging includes the required workers. All copy-producing tools preserve originals. There are no inert or pretend tool cards.

### Wave 2 — Daily desktop access

Tasks: capture, screen OCR, clipboard history and snippets, reference pinning, color picking, workspace launch, keep-awake, scoped file/content search, calculator/converter, tray behavior, and optional shortcut.

Gate: users can use every tool entirely with a mouse. Clipboard history is opt-in and deletable. Search respects selected locations and updates moved/deleted entries. The app stays responsive and does not continuously rescan the whole disk.

### Wave 3 — Media and deeper document tools

Tasks: image editing/metadata handling, advanced PDF tools, tested additional OCR languages, video/audio worker, GIFs, transcription, and optional model-assisted text actions.

Gate: large supported recordings process outside the UI; cancellation is honest; outputs open in independent viewers/players; model/codec packaging is verified; unsupported formats and poor-quality input produce understandable outcomes. Searchable PDFs retain correct page appearance and selectable text placement.

### Wave 4 — Reusable routines

Tasks: compatible action composition, named presets, manually run routines, durable folder triggers and schedules, prepared sharing outputs, restart reconciliation, and optional background execution.

Gate: saving a routine is simple; unexpected files are held back; repeated triggers do not duplicate effects; a stopped/paused routine stays stopped; no unattended action exceeds the saved scope.

### Wave 5 — Devices and remote processing

Tasks: device pairing, transfer receiver, integrity/progress/retry behavior, scoped job dispatch, worker deployment, output retrieval, and clear connection state.

Gate: revoke a device and it loses access; interrupted transfers resume without corrupting outputs; workers run only supported granted actions; the local toolbox remains usable when the other machine is offline. Internet hosting follows a separately reviewed design.

## 14. Verification and acceptance criteria

Use synthetic fixtures and isolated app data. Never test organization, cleanup, or migration against the user's real games, saves, or personal files.

### Product checks

- A fresh installation completes representative daily tasks without commands, an account, model setup, or a tutorial.
- A prepared simple input reaches Run/Create/Copy in at most two meaningful decisions after entering its tool. Tasks such as selecting PDF pages naturally need content choices.
- A new user can find a tool by category without knowing its technical name.
- Completed results can be opened or located immediately.
- File mutations need at most one meaningful review for the same batch, with reasons and details available.
- A small usability trial with people unfamiliar with the project measures completion, unnecessary decisions, and confusing wording. Fix observed problems before expanding the catalog.

### File-policy fixtures

Include synthetic Saved Games and Documents/My Games trees, launcher data, portable applications, parent project markers, `.sav`/`.dat` files, game-owned `.png`/`.txt` companions, unknown extensions matching episode names, real personal media lookalikes, duplicate dependencies, junctions, hard links, cloud-synced roots, and Unicode/Arabic paths.

Verify equivalent protection across every mutation entry point. Verify that understood eligible files still work: making all actions refuse every folder is not success.

### Output correctness

- Images: dimensions, orientation, transparency handling, supported metadata behavior, visual sample comparison, and reported file size.
- PDFs: page count/order, rotation, Unicode text, readable outputs, unsupported/encrypted input handling, and visual inspection in an independent reader.
- OCR: ordinary screenshots, scanned pages, low-quality input, language coverage, cancellation, and packaged offline availability.
- Media: duration, audio presence, synchronization, output playback, large inputs, failure cleanup, and cancellation.
- Clipboard/capture: opt-in behavior, pause/delete, supported formats, multi-monitor scaling, and native focus behavior.
- Jobs: disk full, permission failures, changed input, destination collision, interrupted output, restart, retry, and guarded undo.
- Migration: old databases/configurations load, histories remain inspectable, credentials remain protected, and previously paused automation does not start unexpectedly.

### Performance targets to validate

Measure on a documented reference Windows laptop. Initial targets: visible tool navigation within roughly 200 ms once loaded, progress/queued feedback within one second of starting a long task, and a responsive interface throughout processing. Record startup time, idle CPU/memory, and worker peaks rather than inventing universal guarantees. Large media must not be loaded fully into renderer memory. Search and clipboard retention need explicit bounded storage policies.

## 15. Scope and decisions deferred until implementation

- Final names, icons, colors, and exact card layout follow the approved flows.
- Select PDF-writing, media, screenshot, and native integration dependencies after a small packaged prototype and license/footprint review.
- Confirm the supported codecs, PDF variants, optional OCR languages, and speech model through fixtures before promising them in the app or README.
- Public third-party plugins, arbitrary scripts, automatic PC "optimization," unrestricted disk cleanup, full video editing, cloud hosting, and a new sync engine are outside the initial toolbox delivery.
- Preserve the existing graph editor only where it remains useful; do not make every new action conform to its old limitations.

## 16. Documentation and release handoff

After implementation, update README, architecture, demo instructions, tool help, and screenshots to describe shipped capabilities. Record the current limitations plainly. Capture screenshots from working flows with synthetic content, including image results, PDF pages, clipboard, and a concise file outcome summary.

Source changes and documentation can be prepared for GitHub when implementation is requested. Installer creation and GitHub release publication remain with the user, following their stated preference. Provide tested release instructions at that point; do not run a release as part of this planning task.

## 17. Research references and current implementation

These projects informed interaction patterns, not claims that Relay already supports their features:

- [Rubick](https://github.com/rubickCenter/rubick): one desktop entry point for useful tools, with optional quick search.
- [eSearch](https://github.com/xushengfeng/eSearch): coherent capture, OCR, and screen workflows.
- [EcoPaste](https://github.com/EcoPasteHub/EcoPaste): local clipboard history, search, and direct actions.
- [Umi-OCR](https://github.com/hiroi-sora/Umi-OCR): offline document/image OCR as a complete user task.

Current code references: `src/studio/App.tsx`, `src/studio/Organizer.tsx`, `src/shared/organizer.ts`, `src/desktop/organizer.ts`, `src/desktop/smart-organizer.ts`, `src/desktop/engine.ts`, `src/desktop/batch.ts`, `src/desktop/documents.ts`, `src/desktop/maintenance.ts`, `src/desktop/database.ts`, and `src/server`.

The first implementation work should follow Wave 0 and then prove the new Home-to-result flow with one complete action. The broad catalog is the destination; each delivered tool must finish a real task.
