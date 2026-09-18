# Five-minute demo

1. Create two temporary folders, `Inbox` and `Archive`, and put a sample PDF in `Inbox`.
2. Open **Download organizer**. Select **A download arrives** and choose `Inbox` with the folder picker.
3. Select **Move to my archive** and choose `Archive`. Save the workflow.
4. Choose **Test workflow**, select the sample PDF, and **Preview workflow**. Expand a step in Executions to inspect its planned output. Both folders remain unchanged.
5. Choose **Test workflow → Run workflow**. The PDF moves to `Archive` and gains a date prefix.
6. Choose **Undo files**. The original filename and location are restored, provided the file was not edited.
7. Enable watching and copy a different PDF into `Inbox`. After the file stabilizes, the workflow runs automatically. Pause watching when done.
8. Open **Run history** and inspect the manual and watched runs.

For an AI demonstration, configure an installed Ollama model or a cloud API key in **AI connections**, then use **Document digest** with a text-based PDF and a separate output folder. Preview intentionally skips AI. A real run produces a Markdown summary. Cloud runs transmit extracted text to the chosen provider.

For a failure demonstration, process a file whose target name already exists. Relay stops with a collision error and preserves both files. This illustrates failure handling rather than a simulated success state.
