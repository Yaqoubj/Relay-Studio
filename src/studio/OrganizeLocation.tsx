import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clock,
  FileText,
  Folder,
  FolderOpen,
  HardDrive,
  Image,
  Layers,
  LoaderCircle,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import type {
  CollectionGroup,
  FilingRule,
  LibraryFile,
  LocationState,
  VirtualCollection,
} from '../shared/organize-location';
import type { OrganizerProgress, PlanItem } from '../shared/organizer';
import './organize-location.css';

const api = window.studio;
const base = (value: string) => value.split(/[\\/]/).pop() || value;
const bytes = (value: number) =>
  value < 1024 ** 2
    ? `${(value / 1024).toFixed(0)} KB`
    : value < 1024 ** 3
      ? `${(value / 1024 ** 2).toFixed(1)} MB`
      : `${(value / 1024 ** 3).toFixed(1)} GB`;
const message = (error: unknown) =>
  String((error as Error).message || error).replace(
    /^Error invoking remote method '[^']+': Error: /,
    '',
  );
const tabNames = {
  organize: 'Organize',
  library: 'Library',
  rules: 'Filing choices',
  activity: 'Activity',
};
type Tab = keyof typeof tabNames;

export function OrganizeLocation({ busy, advanced }: { busy: boolean; advanced: () => void }) {
  const [state, setState] = useState<LocationState | null>(null);
  const [tab, setTab] = useState<Tab>('organize');
  const [working, setWorking] = useState(false),
    [error, setError] = useState('');
  const [progress, setProgress] = useState<OrganizerProgress | null>(null);
  const [root, setRoot] = useState(''),
    [ai, setAI] = useState(false),
    [ocr, setOCR] = useState(false);
  const [folders, setFolders] = useState<{ name: string; path: string }[]>([]),
    [bundles, setBundles] = useState<string[]>([]);
  const [query, setQuery] = useState(''),
    [scope, setScope] = useState(''),
    [offset, setOffset] = useState(0);
  const [results, setResults] = useState<LibraryFile[]>([]),
    [searchName, setSearchName] = useState('');
  const [detailOpen, setDetailOpen] = useState(false),
    [details, setDetails] = useState<PlanItem[]>([]),
    [detailOffset, setDetailOffset] = useState(0);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const disabled = busy || working;
  const plan = state?.plan;
  const groups = plan?.groups || [];
  const selected = groups.reduce((sum, group) => sum + (group.selectedCount || 0), 0);
  const completed = groups.reduce((sum, group) => sum + (group.completedCount || 0), 0);
  const refresh = useCallback(async () => setState(await api.locationState()), []);
  useEffect(() => {
    void refresh().catch((e) => setError(message(e)));
    const stop = api.onUpdate(() => void refresh().catch((e) => setError(message(e))));
    const stopProgress = api.onOrganizerProgress(setProgress);
    return () => {
      stop();
      stopProgress();
    };
  }, [refresh]);
  useEffect(() => {
    if (!plan?.root) return;
    setRoot(plan.root);
    void api
      .locationFolders(plan.root)
      .then(setFolders)
      .catch(() => setFolders([]));
    setDetailOpen(false);
    setDetailOffset(0);
    setDetails([]);
  }, [plan?.id]);
  useEffect(() => {
    if (tab !== 'library') return;
    let current = true;
    const timer = setTimeout(
      () =>
        void api
          .librarySearch(query, scope, offset)
          .then((files) => {
            if (current) setResults(files);
          })
          .catch((e) => {
            if (current) setError(message(e));
          }),
      200,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [
    query,
    scope,
    offset,
    tab,
    state?.scopes.map((item) => `${item.id}:${item.updated}`).join('|'),
  ]);
  useEffect(() => {
    let current = true;
    setPreviews({});
    if (!plan || plan.status !== 'review') return;
    // Twelve representative previews, one decode at a time; never decode the whole library.
    const requests = groups
      .filter((group) => group.category === 'Photos')
      .slice(0, 12)
      .flatMap((group) => group.samples.slice(0, 1));
    void (async () => {
      for (const sample of requests) {
        if (!current) return;
        try {
          const value = await api.locationPreview(plan.id, sample.id);
          if (current && value) setPreviews((old) => ({ ...old, [sample.id]: value }));
        } catch {
          /* Text sample remains available. */
        }
      }
    })();
    return () => {
      current = false;
    };
  }, [plan?.id, plan?.status]);
  async function run(action: () => Promise<unknown>) {
    setWorking(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(message(e));
    } finally {
      try {
        await refresh();
      } catch (e) {
        setError(message(e));
      }
      setWorking(false);
    }
  }
  async function pick(known?: 'downloads' | 'desktop' | 'documents') {
    await run(async () => {
      const selectedRoot = await api.locationPick(known);
      if (!selectedRoot) return;
      setRoot(selectedRoot);
      setBundles([]);
      setTab('organize');
      setFolders(await api.locationFolders(selectedRoot));
      await api.locationPrepare({ root: selectedRoot, ai, ocr });
    });
  }
  async function change(group: CollectionGroup) {
    if (!plan) return;
    await run(async () => {
      const destination = await api.locationPick();
      if (destination)
        await api.locationChoose({
          id: plan.id,
          revision: plan.revision!,
          groupId: group.id,
          destination,
        });
    });
  }
  function choose(group: CollectionGroup, selected: boolean) {
    if (plan)
      void run(() =>
        api.locationChoose({ id: plan.id, revision: plan.revision!, groupId: group.id, selected }),
      );
  }
  async function index() {
    await run(async () => {
      const folder = await api.locationPick();
      if (folder) await api.libraryIndex(folder);
    });
  }
  async function showDetails(next = 0) {
    if (!plan) return;
    await run(async () => {
      setDetails(await api.locationDetails(plan.id, next));
      setDetailOffset(next);
      setDetailOpen(true);
    });
  }
  const tidy = state?.tidy.find((item) => item.root === plan?.root);
  const ordinary = groups.filter((group) => !group.key.startsWith('pending:'));
  const pending = groups.filter((group) => group.key.startsWith('pending:'));

  return (
    <main className="location-page">
      <header className="location-heading">
        <div>
          <span className="location-eyebrow">FILES, WITH A PLACE TO GO</span>
          <h1>A little order. A lot less work.</h1>
          <p>
            Organize loose files, move collections intact, and find what’s already on your drives.
          </p>
        </div>
        <button className="location-subtle" onClick={advanced}>
          <Settings2 size={16} /> Advanced tools
        </button>
      </header>
      <nav className="location-tabs" aria-label="Organizer sections">
        {(Object.keys(tabNames) as Tab[]).map((key) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {key === 'organize' ? (
              <Layers size={16} />
            ) : key === 'library' ? (
              <HardDrive size={16} />
            ) : key === 'rules' ? (
              <Settings2 size={16} />
            ) : (
              <Clock size={16} />
            )}
            {tabNames[key]}
            {key === 'rules' && !!state?.rules.length && <span>{state.rules.length}</span>}
          </button>
        ))}
      </nav>
      {error && (
        <div className="location-error" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {progress && (
        <div className="location-progress" role="status">
          <LoaderCircle className="spin" size={17} />
          <div>
            <strong>{progress.stage}</strong>
            <span>
              {progress.count.toLocaleString()}
              {progress.total ? ` / ${progress.total.toLocaleString()}` : ''}
              {progress.path ? ` · ${base(progress.path)}` : ''}
            </span>
          </div>
          <button onClick={() => void api.cancel()}>Cancel</button>
        </div>
      )}

      {tab === 'organize' && (
        <>
          <section className="location-source">
            <div className="location-source-icon">
              <FolderOpen size={28} />
            </div>
            <div>
              <span>START WITH A LOCATION</span>
              <h2>{root ? base(root) : 'Which folder needs some order?'}</h2>
              <p>
                {root ||
                  'Choose a folder. Relay finds the loose files and prepares an arrangement.'}
              </p>
            </div>
            <button className="location-primary" disabled={disabled} onClick={() => void pick()}>
              Choose folder <ArrowRight size={16} />
            </button>
          </section>
          <div className="location-shortcuts">
            <div>
              {(['downloads', 'desktop', 'documents'] as const).map((known) => (
                <button key={known} disabled={disabled} onClick={() => void pick(known)}>
                  <Folder size={15} />
                  {known[0].toUpperCase() + known.slice(1)}
                </button>
              ))}
            </div>
            <details className="location-analysis">
              <summary>
                <Sparkles size={14} /> Analysis options
              </summary>
              <label>
                <input
                  type="checkbox"
                  checked={ai}
                  onChange={(e) => setAI(e.target.checked)}
                  disabled={disabled}
                />{' '}
                Use my model for uncertain documents
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={ocr}
                  onChange={(e) => setOCR(e.target.checked)}
                  disabled={disabled}
                />{' '}
                Read image text with English OCR
              </label>
              <p>
                File types and local document clues work without AI. These options take effect on
                the next preparation.
              </p>
            </details>
          </div>
          {!plan && !progress && (
            <div className="location-intro">
              <div>
                <Layers size={22} />
                <h3>See collections, not a checklist</h3>
                <p>
                  Episodes travel with their subtitles. Photos keep their original names. Documents
                  use text clues when readable.
                </p>
              </div>
              <div>
                <ShieldCheck size={22} />
                <h3>Keep the important things together</h3>
                <p>
                  Existing folders stay intact. Games, saves, projects, and unfinished downloads are
                  held back.
                </p>
              </div>
              <div>
                <Undo2 size={22} />
                <h3>Review once, then organize</h3>
                <p>
                  Choose what moves. File changes are recorded and can be undone while their
                  contents remain unchanged.
                </p>
              </div>
            </div>
          )}
          {plan && (
            <>
              <div className="location-review-heading">
                <div>
                  <span className="location-eyebrow">
                    {plan.status === 'review' ? 'PROPOSED ARRANGEMENT' : 'RECORDED RESULT'}
                  </span>
                  <h2>
                    {plan.status === 'review'
                      ? selected
                        ? `${selected.toLocaleString()} files have a place`
                        : 'Everything stays where it is'
                      : `${completed.toLocaleString()} files moved · ${plan.status}`}
                  </h2>
                  <p>{plan.root}</p>
                </div>
                <div className="location-review-actions">
                  {plan.status === 'review' ? (
                    <button
                      className="location-primary"
                      disabled={disabled || !selected}
                      onClick={() => void run(() => api.locationApply(plan.id, plan.revision!))}
                    >
                      Organize {selected ? selected.toLocaleString() : ''} files{' '}
                      <ArrowRight size={17} />
                    </button>
                  ) : (
                    !['undone', 'running', 'undoing'].includes(plan.status) && (
                      <button
                        className="location-subtle"
                        disabled={disabled}
                        onClick={() => void run(() => api.locationUndo(plan.id))}
                      >
                        <Undo2 size={16} /> Undo this batch
                      </button>
                    )
                  )}
                </div>
              </div>
              {plan.error && (
                <div className="location-error">
                  <span>
                    {plan.error} Completed effects remain recorded. Inspect file details before
                    continuing.
                  </span>
                </div>
              )}
              <div className="location-layout">
                <section className="location-groups">
                  {!groups.length && (
                    <div className="location-empty">
                      <Check size={25} />
                      <h3>No loose files to move</h3>
                      <p>
                        Existing folders are left intact. Use Whole folder move for an explicit
                        collection relocation, or Library to inspect deeper.
                      </p>
                    </div>
                  )}
                  {ordinary.map((group) => (
                    <article
                      className={`location-group ${group.kept ? 'kept' : ''} ${group.issue ? 'attention' : ''}`}
                      key={group.id}
                    >
                      <div className="location-group-top">
                        <span className={`location-group-icon ${group.category.toLowerCase()}`}>
                          {group.bundleId ? (
                            <Layers size={22} />
                          ) : group.category === 'Photos' ? (
                            <Image size={22} />
                          ) : group.category === 'Documents' ? (
                            <FileText size={22} />
                          ) : (
                            <Folder size={22} />
                          )}
                        </span>
                        <div>
                          <h3>{group.title}</h3>
                          <span>
                            {group.count.toLocaleString()} files · {bytes(group.bytes)}
                            {group.bundleId ? ' · Whole folder' : ''}
                          </span>
                        </div>
                        <span className={`location-badge ${group.issue ? 'amber' : ''}`}>
                          {group.kept
                            ? 'Keep here'
                            : group.issue
                              ? 'Needs attention'
                              : plan.status === 'review'
                                ? group.existing
                                  ? 'Existing folder'
                                  : 'New folder'
                                : `${group.completedCount || 0} moved`}
                        </span>
                      </div>
                      <div className="location-samples">
                        {group.samples.map((sample, i) => (
                          <div key={`${sample.id}:${i}`}>
                            {previews[sample.id] && (
                              <img src={previews[sample.id]} alt={sample.name} />
                            )}
                            <span>{sample.name}</span>
                            {sample.snippet && <p>{sample.snippet}</p>}
                          </div>
                        ))}
                      </div>
                      <div className="location-destination">
                        <ChevronRight size={16} />
                        <div>
                          <small>DESTINATION</small>
                          <span>{group.destination || 'Choose a matching folder'}</span>
                        </div>
                      </div>
                      {group.issue && <p className="location-group-issue">{group.issue}</p>}
                      <details className="location-evidence">
                        <summary>Why this group?</summary>
                        {group.evidence.map((text) => (
                          <p key={text}>{text}</p>
                        ))}
                      </details>
                      <footer>
                        {plan.status === 'review' ? (
                          <>
                            <button disabled={disabled} onClick={() => choose(group, !!group.kept)}>
                              {group.kept ? 'Include' : 'Keep here'}
                            </button>
                            <button disabled={disabled} onClick={() => void change(group)}>
                              Change destination
                            </button>
                            {!group.bundleId && !group.issue && (
                              <button
                                disabled={disabled}
                                onClick={() =>
                                  void run(() =>
                                    api.locationChoose({
                                      id: plan.id,
                                      revision: plan.revision!,
                                      groupId: group.id,
                                      remember: true,
                                    }),
                                  )
                                }
                              >
                                Remember this choice
                              </button>
                            )}
                          </>
                        ) : (
                          <button
                            disabled={disabled || !group.completedCount}
                            onClick={() => void run(() => api.locationOpen(plan.id, group.id))}
                          >
                            <FolderOpen size={14} /> Open destination
                          </button>
                        )}
                      </footer>
                    </article>
                  ))}
                  {!!pending.length && (
                    <section className="location-held">
                      <h3>Needs attention · kept here</h3>
                      {pending.map((group) => (
                        <div key={group.id}>
                          <strong>{group.count} files</strong>
                          <p>{group.issue}</p>
                          <span>{group.samples.map((sample) => sample.name).join(' · ')}</span>
                        </div>
                      ))}
                    </section>
                  )}
                </section>
                <aside className="location-arrangement">
                  <h3>
                    <Folder size={17} /> Where things go
                  </h3>
                  <p>Original filenames stay the same.</p>
                  <div className="location-tree">
                    <strong>
                      <FolderOpen size={15} /> {base(plan.root)}
                    </strong>
                    {ordinary
                      .filter(
                        (group) => !group.kept && (group.selectedCount || group.completedCount),
                      )
                      .slice(0, 30)
                      .map((group) => (
                        <div key={group.id}>
                          <span className="location-tree-line" />
                          <Folder size={14} />
                          <div>
                            <strong>{group.title}</strong>
                            <small>{group.destination}</small>
                          </div>
                          <span>{group.selectedCount || group.completedCount}</span>
                        </div>
                      ))}
                  </div>
                  <div className="location-preserved">
                    <ShieldCheck size={18} />
                    <div>
                      <strong>Left in place</strong>
                      <p>
                        {state?.unchanged.count || 0} held files.
                        {state?.unchanged.reasons.slice(0, 3).map((reason) => (
                          <span key={reason}>{reason}</span>
                        ))}
                      </p>
                    </div>
                  </div>
                  {!!plan.notes?.length && (
                    <details className="location-evidence">
                      <summary>Analysis limits and notes</summary>
                      {plan.notes.map((note, index) => (
                        <p key={index}>{note}</p>
                      ))}
                    </details>
                  )}
                  <button
                    className="location-subtle"
                    disabled={disabled}
                    onClick={() => void showDetails()}
                  >
                    <FileText size={15} /> File details
                  </button>
                  <div className="location-tidy">
                    <h3>Keep this location tidy</h3>
                    <p>
                      Stable new files follow remembered choices while Relay is open. Uncertain
                      files stay here.
                    </p>
                    <button
                      disabled={
                        disabled ||
                        !state?.rules.some((rule) => rule.enabled && rule.scope === plan.root)
                      }
                      onClick={() => void run(() => api.locationTidy(plan.root, !tidy?.enabled))}
                    >
                      {tidy?.enabled ? 'Pause automatic filing' : 'Enable automatic filing'}
                    </button>
                    {tidy?.error && <p className="location-group-issue">{tidy.error}</p>}
                    {tidy?.lastCheck && (
                      <small>Checked {new Date(tidy.lastCheck).toLocaleTimeString()}</small>
                    )}
                  </div>
                </aside>
              </div>
              {detailOpen && (
                <section className="location-detail">
                  <div>
                    <h3>File details</h3>
                    <button aria-label="Close file details" onClick={() => setDetailOpen(false)}>
                      <X size={16} />
                    </button>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>Original</th>
                        <th>Destination</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.map((item) => (
                        <tr key={item.id}>
                          <td>{item.source}</td>
                          <td>{item.destination}</td>
                          <td>{item.error || item.issue || item.state}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <footer>
                    <button
                      disabled={disabled || detailOffset === 0}
                      onClick={() => void showDetails(Math.max(0, detailOffset - 100))}
                    >
                      Previous
                    </button>
                    <span>
                      {detailOffset + 1}–{detailOffset + details.length}
                    </span>
                    <button
                      disabled={disabled || details.length < 100}
                      onClick={() => void showDetails(detailOffset + 100)}
                    >
                      Next
                    </button>
                  </footer>
                </section>
              )}
            </>
          )}
          {root && (
            <details className="location-bundles">
              <summary>
                <Layers size={17} /> Whole folder move{' '}
                <span>For courses, photo collections, and other personal bundles</span>
              </summary>
              <p>
                Choose an existing folder to move as a whole. Contents, names, and empty subfolders
                stay together. Application and game folders remain protected.
              </p>
              <div>
                {folders.slice(0, 100).map((folder) => (
                  <label key={folder.path}>
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={bundles.includes(folder.path)}
                      onChange={(e) =>
                        setBundles(
                          e.target.checked
                            ? [...bundles, folder.path]
                            : bundles.filter((p) => p !== folder.path),
                        )
                      }
                    />
                    <Folder size={15} />
                    {folder.name}
                  </label>
                ))}
              </div>
              <button
                className="location-subtle"
                disabled={disabled || !bundles.length}
                onClick={() => void run(() => api.locationPrepare({ root, ai, ocr, bundles }))}
              >
                Review collection moves <ArrowRight size={15} />
              </button>
            </details>
          )}
        </>
      )}

      {tab === 'library' && (
        <>
          <section className="location-section-heading">
            <div>
              <h2>What’s on your drives?</h2>
              <p>
                Index chosen areas. Search names and locally extracted document text without moving
                files.
              </p>
            </div>
            <button className="location-primary" disabled={disabled} onClick={() => void index()}>
              <HardDrive size={17} /> Add location
            </button>
          </section>
          <div className="location-scopes">
            {state?.scopes.map((item) => (
              <article key={item.id}>
                <HardDrive size={22} />
                <div>
                  <h3>{base(item.root)}</h3>
                  <p>{item.root}</p>
                  <span>
                    {item.count.toLocaleString()} files · {bytes(item.bytes)} · {item.status}
                    {item.updated ? ` · ${new Date(item.updated).toLocaleDateString()}` : ''}
                  </span>
                  {item.error && <p>{item.error}</p>}
                </div>
                <div>
                  <button
                    disabled={disabled || item.status === 'offline'}
                    onClick={() =>
                      void run(() =>
                        api.libraryIndex(
                          item.root,
                          item.status === 'partial' ? item.id : undefined,
                        ),
                      )
                    }
                  >
                    {item.status === 'partial' ? 'Continue section' : 'Refresh index'}
                  </button>
                  <button
                    disabled={disabled || item.status === 'offline'}
                    onClick={() => {
                      setTab('organize');
                      void run(() => api.locationPrepare({ root: item.root, ai, ocr }));
                    }}
                  >
                    Organize loose files
                  </button>
                  <button
                    disabled={disabled}
                    onClick={() => void run(() => api.libraryForget(item.id))}
                  >
                    Remove index
                  </button>
                </div>
              </article>
            ))}
          </div>
          <div className="location-library-search">
            <label>
              <Search size={18} />
              <input
                aria-label="Search library"
                placeholder="Search a name, topic, or text inside a document"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <select
              aria-label="Search location"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All indexed locations</option>
              {state?.scopes.map((item) => (
                <option key={item.id} value={item.id}>
                  {base(item.root)}
                  {item.status === 'offline' ? ' (offline)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="location-saved-searches">
            {state?.collections.map((collection) => (
              <div key={collection.id}>
                <button
                  onClick={() => {
                    setQuery(collection.query);
                    setScope(collection.scope);
                    setOffset(0);
                  }}
                >
                  {collection.name}
                </button>
                <button
                  aria-label={`Remove ${collection.name}`}
                  disabled={disabled}
                  onClick={() => void run(() => api.libraryCollection(collection, true))}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <input
              aria-label="Saved search name"
              placeholder="Name this search"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
            />
            <button
              disabled={disabled || !searchName.trim() || !query.trim()}
              onClick={() =>
                void run(async () => {
                  await api.libraryCollection({
                    id: '',
                    name: searchName,
                    query,
                    scope,
                  } satisfies VirtualCollection);
                  setSearchName('');
                })
              }
            >
              Save search
            </button>
          </div>
          {!state?.scopes.length && (
            <div className="location-empty">
              <HardDrive size={30} />
              <h3>Your folders stay yours</h3>
              <p>
                Add a personal folder or data drive. Relay records a searchable index; it doesn’t
                import or relocate your library.
              </p>
            </div>
          )}
          {!!state?.scopes.length && (
            <>
              <div className="location-search-results">
                {results.map((file) => (
                  <article key={file.id}>
                    <FileText size={18} />
                    <div>
                      <h3>{base(file.path)}</h3>
                      <p>{file.path}</p>
                      {file.snippet && (
                        <small>{file.snippet.replace(/\s+/g, ' ').slice(0, 220)}</small>
                      )}
                    </div>
                    <span>{bytes(file.size)}</span>
                    <button
                      disabled={
                        disabled ||
                        state.scopes.find((scope) => scope.id === file.scopeId)?.status ===
                          'offline'
                      }
                      onClick={() => void run(() => api.libraryOpen(file.id))}
                    >
                      Show folder
                    </button>
                  </article>
                ))}
              </div>
              {!results.length && (
                <div className="location-empty">No indexed files match this search.</div>
              )}
              <div className="location-pagination">
                <button
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 100))}
                >
                  Previous
                </button>
                <span>
                  Showing {offset + (results.length ? 1 : 0)}–{offset + results.length}
                </span>
                <button disabled={results.length < 100} onClick={() => setOffset(offset + 100)}>
                  Next
                </button>
              </div>
              <p className="location-footnote">
                An index is a snapshot. Refresh to reflect removals and new files. Each section
                reads up to 100 changed documents; files without extracted text remain searchable by
                name. Offline locations keep their last index.
              </p>
            </>
          )}
        </>
      )}

      {tab === 'rules' && (
        <>
          <section className="location-section-heading">
            <div>
              <h2>Teach Relay once.</h2>
              <p>
                Remember a collection’s destination during review. These choices apply only to that
                source and collection.
              </p>
            </div>
          </section>
          {!state?.rules.length && (
            <div className="location-empty">
              <Settings2 size={28} />
              <h3>No remembered choices yet</h3>
              <p>
                Use Remember this choice on a collection card. Then enable automatic filing for its
                source if you want new arrivals handled.
              </p>
            </div>
          )}
          {state?.rules.map((rule) => (
            <RuleEditor
              key={`${rule.id}:${rule.title}:${rule.enabled}:${rule.priority}:${rule.destination}`}
              rule={rule}
              disabled={disabled}
              save={(next, remove) => void run(() => api.locationRule(next, remove))}
              choose={() => api.locationPick()}
            />
          ))}
          {!!state?.tidy.length && (
            <section className="location-tidy-list">
              <h2>Automatic filing</h2>
              {state.tidy.map((item) => (
                <div key={item.id}>
                  <div>
                    <strong>{item.root}</strong>
                    <p>
                      {item.error ||
                        (item.enabled
                          ? 'Active while Relay is open. Completed arrivals wait at least 10 seconds.'
                          : 'Paused')}
                    </p>
                  </div>
                  <button
                    disabled={disabled}
                    onClick={() => void run(() => api.locationTidy(item.root, !item.enabled))}
                  >
                    {item.enabled ? 'Pause' : 'Enable'}
                  </button>
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {tab === 'activity' && (
        <>
          <section className="location-section-heading">
            <div>
              <h2>Organization history</h2>
              <p>Manual and automatic batches share the same file journal.</p>
            </div>
          </section>
          {!state?.history.length && (
            <div className="location-empty">Prepared and completed batches will appear here.</div>
          )}
          {state?.history.map((entry) => (
            <article className="location-history" key={entry.id}>
              <Clock size={19} />
              <div>
                <strong>{new Date(entry.createdAt).toLocaleString()}</strong>
                <span>
                  {entry.count} planned files · {entry.status}
                </span>
              </div>
              <button
                disabled={disabled}
                onClick={() => {
                  setTab('organize');
                  void run(() => api.locationLoad(entry.id));
                }}
              >
                Inspect batch
              </button>
            </article>
          ))}
          {!!state?.pendingArrivals.length && (
            <section className="location-held">
              <h3>Automatic filing · needs attention</h3>
              <p>
                These files stay in their original location. Choose that location again to prepare a
                fresh review.
              </p>
              {state.pendingArrivals.map((item) => (
                <div key={item.id}>
                  <strong>{item.path}</strong>
                  <p>{item.error || 'No approved, unambiguous filing choice matched.'}</p>
                  {item.planId && (
                    <button
                      disabled={disabled}
                      onClick={() => {
                        setTab('organize');
                        void run(() => api.locationLoad(item.planId!));
                      }}
                    >
                      Inspect recorded batch
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}

function RuleEditor({
  rule,
  disabled,
  save,
  choose,
}: {
  rule: FilingRule;
  disabled: boolean;
  save: (rule: FilingRule, remove?: boolean) => void;
  choose: () => Promise<string | null>;
}) {
  const [form, setForm] = useState(rule),
    [error, setError] = useState('');
  return (
    <article className="location-rule">
      <header>
        <Settings2 size={20} />
        <input
          aria-label={`Name for ${rule.title}`}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <label>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />{' '}
          Enabled
        </label>
      </header>
      <div className="location-rule-paths">
        <div>
          <small>ONLY IN THIS SOURCE</small>
          <p>{rule.scope}</p>
          <span>{rule.key}</span>
        </div>
        <ArrowRight size={18} />
        <div>
          <small>DESTINATION</small>
          <p>{form.destination}</p>
          <button
            disabled={disabled}
            onClick={async () => {
              try {
                const folder = await choose();
                if (folder) setForm({ ...form, destination: folder });
              } catch (e) {
                setError(message(e));
              }
            }}
          >
            Change folder
          </button>
        </div>
      </div>
      <p className="location-rule-examples">Examples: {rule.examples.join(' · ')}</p>
      <footer>
        <label>
          Priority{' '}
          <input
            aria-label={`Priority for ${rule.title}`}
            type="number"
            min={-100}
            max={100}
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
          />
        </label>
        <span>Higher wins. Equal conflicting choices wait for you.</span>
        <button disabled={disabled} onClick={() => save(form)}>
          Save choice
        </button>
        <button disabled={disabled} onClick={() => save(rule, true)}>
          Delete
        </button>
      </footer>
      {error && <p className="location-group-issue">{error}</p>}
    </article>
  );
}
