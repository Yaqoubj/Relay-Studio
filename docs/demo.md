# Try Relay Studio

Use a disposable personal test folder. Keep fixtures outside this repository and other code projects: ancestor protection intentionally excludes those trees.

## Organize a mixed folder

1. Add three supported videos named `Example.S01E01.mkv` through `Example.S01E03.mkv`, with a matching `.en.srt` for one episode. Add a real picture, a text document, and an unfamiliar file extension.
2. Create `Videos/Example/Season 01` in the same folder. Optionally add a text document containing `Invoice`, `Total`, and sample invoice details.
3. Open **File organizer → Choose folder**. Preparation starts immediately.
4. Inspect the collection cards. The episodes and subtitle should reuse the existing season folder. The invoice should propose `Documents/Invoices`. The unfamiliar extension stays under Needs attention. Picture filenames stay the same.
5. Use **Keep here** on a collection you want left alone. **Change destination** picks an existing destination. **Remember this choice** teaches only this source/collection combination.
6. Choose **Organize files**. Inspect the recorded result and optional File details. Use **Open destination**, then **Undo this batch** without editing outputs.

These are intended outcomes to validate, not a report of a completed test run.

## Remember destinations and handle arrivals

1. Prepare a source and remember a collection destination.
2. Apply the manual review before enabling **Keep this location tidy**. Existing files at first enable stay pending for manual review.
3. Add a different eligible file matching that collection. Leave Relay open. The monitor checks every 15 seconds and requires at least 10 seconds of unchanged file identity/metadata.
4. Open **Activity** to inspect its batch. An unfamiliar or ambiguous arrival should stay in place.
5. Use **Filing choices** to edit priority, destination, or enabled state. Pause automatic filing when finished. Undo pauses its source to keep restored files from immediately moving again.

## Move a whole personal collection

1. Put a personal course folder inside the source, with videos, PDFs, notes, and an empty subfolder. Avoid application/game/code-project markers for this fixture.
2. Expand **Whole folder move**, select the course, and choose **Review collection moves**.
3. Inspect the whole-folder card. The default destination is `Collections/<original folder name>`. To choose a different parent, use **Change destination**.
4. Apply the review. Verify names, contents, empty folders, and guarded undo. Existing destination collections are held back rather than merged.

## Explore a library

1. Open **Library → Add location** and choose a personal folder or data drive.
2. Search a filename or readable document phrase. Choose **Show folder**. Save a named search to revisit it without moving files.
3. Refresh the index after changing the source. Continue pending directory sections when shown.
4. For an external-drive fixture, disconnect it and reopen Library. Its last index should remain searchable with an offline label.
5. **Remove index** removes Relay metadata only. It does not delete files.

## Pictures, PDFs, and text

Use **All tools** to resize a real picture, create a PDF from several pictures, merge PDFs, extract pages, or get text. Results are copies in Documents/Relay Results. Use the input/output previews and Open/Folder controls. Text can be edited and copied. English OCR runs locally.

## Advanced workflows

**Advanced tools** opens specialized collection templates for duplicates, backups, renaming, archives, delivery manifests, and AI document outputs. **Workflows** opens the connected-step editor. Choose source and output folders in each step, preview one sample, then run it. Graph watchers start paused after restart. Preview does not call AI or change files.

The checked-in screenshots show synthetic folders and files from passing desktop tests. See [organizer collections](organizer-collections.png), [completed review](organizer-complete.png), and [library search](library-overview.png). The compact organizer view is also available at [1120×720](organizer-compact.png).
