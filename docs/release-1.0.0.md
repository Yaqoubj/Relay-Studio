Relay Studio replaces the original OverlayAI product direction with a visual desktop automation studio.

### Included

- React Flow editor with configurable triggers, conditions, and actions.
- File watching, copy/move/rename, document extraction, text output, and notifications.
- Preview mode, per-step execution details, SQLite run history, and guarded file undo.
- Optional local Ollama and OpenAI-compatible cloud connections.
- Three editable templates: Download organizer, Document digest, and Meeting follow-up.
- Workflow import/export without local folder paths or credentials.

### Download

Use `Relay-Studio-1.0.0-x64.exe` on Windows x64. The installer is unsigned. `SHA256SUMS.txt` provides its checksum.

Start with Download organizer for a workflow that requires no AI. Folder watchers start paused; select your folders and preview a sample before enabling them. AI workflows require your own Ollama model or API account.

### Validation

17 domain tests and 2 real Electron integration tests pass. The packaged application was launched and its PDF parser checked. Live cloud inference was not tested with a paid API key; the AI adapter is tested against a controlled local server.

### Current limits

Windows is the tested platform. The app must remain open for watching. No OCR, schedules, arbitrary scripts, parallel branches, cloud sync, or spreadsheet connector. Undo applies only to recorded, unchanged file effects; interrupted runs require inspection. See the README and architecture documentation for details.
