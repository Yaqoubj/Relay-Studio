<p align="center"><img src="assets/relay.png" width="76" alt="Relay Studio logo" /></p>
<h1 align="center">Relay Studio</h1>
<p align="center"><strong>A little flow. A lot off your plate.</strong><br/>Visual desktop automation for files, documents, and optional AI.</p>
<p align="center"><a href="https://github.com/Yaqoubj/OverLayAI/releases">Download for Windows</a> · <a href="docs/demo.md">Try the demo</a> · <a href="docs/architecture.md">Architecture</a></p>

![Relay Studio visual workflow editor](docs/studio.png)

Relay Studio turns repetitive desktop work into connected steps. Watch a folder, check a condition, read a document, transform it with AI, and move or create files—all from a visual canvas with inspectable execution history.

**This is a working Electron application with its own workflow engine, not an n8n wrapper.** AI is optional. The download-organizing workflow runs entirely offline without an account or API key.

## Why it exists

Small desktop routines often fall between doing everything manually and maintaining a collection of scripts. Relay makes those routines visible: see the plan before a run, inspect what each step produced, and undo supported file changes when needed.

## What you can build

| Template | Workflow |
| --- | --- |
| **Download organizer** | New file → PDF condition → move to archive → add date prefix → notification |
| **Document digest** | New file → PDF condition → extract text → AI summary → Markdown file → notification |
| **Meeting follow-up** | Text transcript → read text → AI decisions and action items → Markdown notes → notification |

Templates are real editable recipes. Folder paths begin empty, watchers begin paused, and the workspace has no fabricated execution history.

## Features

- **Visual editor:** add, drag, configure, and connect steps using React Flow; conditions expose Yes and No branches.
- **Nine step types:** folder trigger, condition, document reader, AI transform, rename, copy, move, write text, and notification.
- **Preview mode:** inspect deterministic actions without changing files, notifying, or calling AI. AI-dependent steps are marked unresolved.
- **Folder watching:** new, stabilized files are queued and processed while the app is open.
- **Execution inspector:** inspect each visited step’s input path, output excerpt, status, and duration.
- **Guarded file operations:** exclusive creation, collision checks, safe filenames, hash-checked undo, and cancellation between steps.
- **Local persistence:** SQLite workflows and execution journals; runs interrupted by closure are marked on restart.
- **Portable recipes:** export and import JSON workflows without local folder paths or credentials.
- **Optional AI:** local Ollama or an OpenAI-compatible HTTPS provider, with OS-encrypted API-key storage and validated structured fields.

![Execution history with real test runs](docs/history.png)

## Get started

Download the Windows installer from [Releases](https://github.com/Yaqoubj/OverLayAI/releases). The installer is unsigned; the project does not have a commercial code-signing certificate.

For a first workflow, open **Download organizer**, choose source and archive folders in the step inspector, and save. Select **Test workflow**, pick a sample PDF, and preview it. Then run it for real. See the [five-minute walkthrough](docs/demo.md) for watching, undo, and a failure demonstration.

### Development

Requires **Node.js 24+** and npm. Windows is the tested target.

```sh
npm ci
npm start
```

```sh
npm test                 # Domain, persistence, and local AI-adapter tests
npm run test:e2e          # Real Electron UI and filesystem integration test
npm run build            # Type-check + renderer/main/preload builds
npm run dist:dir          # Unpacked desktop application
npm run dist:installer    # Windows installer in dist/
```

The end-to-end tests use temporary workspaces and mock native dialog answers. They exercise the real renderer, preload, IPC, SQLite store, filesystem operations, and watcher. Screenshots in this README are captured from those tests. Actual cloud inference requires your own credentials and is not part of the automated suite.

A [Windows CI template](docs/ci-template.yml) is included. To enable GitHub Actions, copy it to `.github/workflows/ci.yml` using an account/token with workflow-write permission. Automated checks are not enabled on this repository yet.

## AI setup

**Local:** install Ollama separately, download a model, then enter its exact model name and loopback endpoint in **AI connections**. The default endpoint is `http://127.0.0.1:11434`. Relay does not bundle models.

**Cloud:** enter your provider’s HTTPS base URL, Chat Completions-compatible model name, and API key. Enable the explicit document-processing permission and test the connection. API charges are billed by your provider; a chat subscription does not supply API access.

An AI step accepts instructions and returns text or required string fields. Later steps can use `{{ai}}` or `{{ai.company}}`. Bad JSON or missing fields stop execution. AI cannot run shell commands or choose arbitrary tools; only configured action blocks perform file operations.

The adapters follow the [Ollama API](https://docs.ollama.com/api/chat) and [Chat Completions schema](https://developers.openai.com/api/reference/cli/resources/chat/subresources/completions). Compatible providers can differ in supported models and structured-output behavior.

## Stack

| Layer | Implementation |
| --- | --- |
| Desktop | Electron with sandboxed renderer and narrow IPC bridge |
| UI | React, TypeScript, React Flow, Lucide |
| Runtime | Custom sequential TypeScript graph executor |
| Persistence | SQLite via Node’s built-in `node:sqlite` |
| Watching | Chokidar with file-stability checks and bounded queue |
| Documents | Text readers and `pdf-parse` for text-based PDFs |
| Build and tests | Vite, esbuild, Node test runner, Playwright Electron |

```text
src/studio/       React canvas, step inspector, templates, history, connections
src/desktop/      Electron host, execution engine, validation, SQLite, AI adapters
src/shared/       Workflow types and step/template catalog
tests/           Domain tests and Electron end-to-end test
docs/            Screenshots, demo walkthrough, architecture and tradeoffs
```

Read [Architecture and tradeoffs](docs/architecture.md) for graph semantics, permission boundaries, preview behavior, and recovery guarantees.

## Honest limits

- Windows is tested; macOS and Linux distributions are not supplied.
- Folder watching runs only while the app is open, starts paused after restart, and ignores existing files. It is not an operating-system background service.
- No scheduling, loops, parallel branches, branch merging, arbitrary scripts, OCR, spreadsheet connector, team accounts, or cloud sync in this version.
- Input files are limited to 25 MB. AI input is limited to 60,000 characters and each request to 120 seconds.
- Undo is available only for recorded, unchanged file effects. AI calls and notifications cannot be undone. Filesystem changes and database journal updates are not crash-atomic; inspect interrupted runs before retrying.
- Run history contains local paths and document excerpts in plaintext. Only API keys are encrypted. The UI displays the latest 100 runs; older records remain in SQLite.
- Windows installers are unsigned. Native dialog appearance, OS notifications, and a real provider/model connection need environment-specific checks.

Data lives in Electron’s user-data folder, normally `%APPDATA%/relay-studio` on Windows, in `relay.sqlite`. Quit the app before backing up that directory. There is no in-app workspace restore yet.

## Project history

This repository began as OverlayAI, a floating AI-site wrapper. Relay Studio replaces that product direction with an independent local automation engine and visual editor. The old source is retained under `src/main`, `src/renderer`, and `native`, excluded from the new application build. The [original README](docs/overlayai-legacy.md) documents that earlier version.

## License

[MIT](LICENSE).
