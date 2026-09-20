import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  FolderSearch,
  HardDrive,
  FilePenLine,
  Download,
  ShieldCheck,
  Undo2,
  Sparkles,
} from 'lucide-react';
import {
  fileCategories,
  organizerTemplates,
  organizerDefaults,
  needsAI,
  type OrganizerTemplate,
  type OrganizerState,
  type OrganizerProgress,
  type PlanOptions,
  type PlanItem,
} from '../shared/organizer';
import './organizer.css';

const api = window.studio;
const defaults = organizerDefaults;
const bytes = (value: number) =>
  value < 1024
    ? `${value} B`
    : value < 1024 ** 2
      ? `${(value / 1024).toFixed(1)} KB`
      : value < 1024 ** 3
        ? `${(value / 1024 ** 2).toFixed(1)} MB`
        : `${(value / 1024 ** 3).toFixed(1)} GB`;
const filename = (value: string) => value.split(/[\\/]/).pop();
const marks: Partial<Record<OrganizerTemplate, typeof HardDrive>> = {
  drive: HardDrive,
  downloads: Download,
  rename: FilePenLine,
};
export function OrganizerCards({
  choose,
  ai = false,
}: {
  choose: (id: OrganizerTemplate) => void;
  ai?: boolean;
}) {
  const cards = (advanced: boolean) =>
    organizerTemplates
      .filter(
        (template) =>
          !!template.ai === ai &&
          ['smart', 'smart-ai', 'combine', 'cleanup', 'delivery'].includes(template.id) !==
            advanced,
      )
      .map((template) => {
        const Icon = marks[template.id] || (ai ? Sparkles : FolderSearch);
        return (
          <button
            className="organization-template"
            key={template.id}
            onClick={() => choose(template.id)}
          >
            <Icon size={23} />
            <span className="organization-badge">{ai ? 'AI POWERED' : 'NO AI'}</span>
            <h3>{template.name}</h3>
            <p>{template.description}</p>
            <code>{template.example}</code>
            <span className="organization-card-link">
              Open <ArrowRight size={15} />
            </span>
          </button>
        );
      });
  return (
    <>
      <div className="organization-cards">{cards(false)}</div>
      <details className="organization-presets">
        <summary>Specialized {ai ? 'AI' : 'file'} tools</summary>
        <div className="organization-cards">{cards(true)}</div>
      </details>
    </>
  );
}
export function Organizer({
  initialTemplate,
  busy,
}: {
  initialTemplate?: OrganizerTemplate;
  busy: boolean;
}) {
  const [state, setState] = useState<OrganizerState | null>(null);
  const [progress, setProgress] = useState<OrganizerProgress | null>(null);
  const [options, setOptions] = useState<PlanOptions>(defaults(initialTemplate || 'smart'));
  const [root, setRoot] = useState('');
  const [recursive, setRecursive] = useState(true);
  const [scanDirty, setScanDirty] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewed, setReviewed] = useState(false);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [presetName, setPresetName] = useState('');
  const [everyHours, setEveryHours] = useState(24);
  const [scheduled, setScheduled] = useState(false);
  const locked = busy || working;
  const usesAI = needsAI(options.template);
  const smart = ['smart', 'smart-ai', 'combine'].includes(options.template);
  const copyOnly = [
    'delivery',
    'backup',
    'ai-receipts',
    'ai-meetings',
    'ai-research',
    'ai-adviser',
  ].includes(options.template);
  const refresh = useCallback(async () => {
    const next = await api.organizerState();
    setState(next);
    setProgress(next.progress);
    return next;
  }, []);
  useEffect(() => {
    let live = true;
    void api
      .organizerState()
      .then((next) => {
        if (!live) return;
        setState(next);
        setProgress(next.progress);
        setRoot(next.plan?.root || next.scan?.root || '');
        setRecursive(next.scan?.options?.recursive ?? true);
        setScanDirty(!!next.plan && next.plan.root !== next.scan?.root);
        if (next.plan && !initialTemplate) setOptions(next.plan.options);
        else if (next.scan?.options)
          setOptions((previous) => ({ ...previous, exclude: next.scan!.options!.exclude }));
        if (initialTemplate && next.plan) setDirty(true);
      })
      .catch((e) => setError(String(e)));
    const unsubscribe = api.onUpdate(() => {
      void refresh().catch((e) => setError(String(e)));
    });
    const unprogress = api.onOrganizerProgress(setProgress);
    return () => {
      live = false;
      unsubscribe();
      unprogress();
    };
  }, [refresh, initialTemplate]);
  const plan = state?.plan;
  const scan = state?.scan;
  useEffect(() => {
    setSelected(new Set(plan?.items.filter((i) => i.selected).map((i) => i.id) || []));
    setReviewed(false);
    setPage(0);
  }, [plan?.id, plan?.status]);
  const act = async (action: () => Promise<unknown>) => {
    setWorking(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
    } finally {
      setWorking(false);
    }
  };
  const change = (patch: Partial<PlanOptions>) => {
    setOptions((previous) => ({ ...previous, ...patch }));
    setDirty(true);
    setReviewed(false);
  };
  const choose = (template: OrganizerTemplate) => {
    setOptions((previous) => ({
      ...defaults(template),
      destination: previous.destination,
      exclude: previous.exclude,
    }));
    setDirty(true);
    setReviewed(false);
  };
  const browse = (target: 'root' | 'destination' | 'exclude' | 'keeper') =>
    act(async () => {
      const folder = await api.chooseFolder();
      if (!folder) return;
      if (target === 'root') {
        setRoot(folder);
        setScanDirty(true);
        setDirty(true);
        setReviewed(false);
      } else if (target === 'exclude') {
        change({ exclude: [...new Set([...options.exclude, folder])] });
        setScanDirty(true);
      } else if (target === 'keeper') change({ keepFolder: folder });
      else change({ destination: folder });
    });
  const filtered = useMemo(
    () =>
      plan?.items.filter((i) =>
        `${i.source} ${i.destination} ${i.issue || ''} ${i.state}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ) || [],
    [plan, search],
  );
  const ready = plan?.status === 'review';
  const count = plan?.items.filter((i) => selected.has(i.id) && !i.issue).length || 0;
  const selectedBytes =
    plan?.items.reduce(
      (sum, i) =>
        sum +
        (selected.has(i.id) && !i.issue
          ? i.action === 'write'
            ? new TextEncoder().encode(i.content || '').length
            : i.stamp.size
          : 0),
      0,
    ) || 0;
  const conflictCount = plan?.items.filter((i) => i.issue).length || 0;
  const template = organizerTemplates.find((t) => t.id === options.template)!;
  const groups = useMemo(() => {
    const result = new Map<string, PlanItem[]>();
    for (const item of plan?.items || []) {
      const group = item.group || filename(item.destination) || 'Other';
      const entries = result.get(group);
      if (entries) entries.push(item);
      else result.set(group, [item]);
    }
    return [...result.entries()];
  }, [plan]);
  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setReviewed(false);
  };
  return (
    <section className="organizer page-content">
      <div className="organization-heading">
        <div>
          <span className="eyebrow">YOUR FILES, UNDER CONTROL</span>
          <h1>Organize your files.</h1>
          <p>Scan a folder or data drive. Review every change before applying it.</p>
        </div>
        <span className="organization-local">
          <ShieldCheck size={17} />{' '}
          {usesAI
            ? 'Your connected model · Review before applying'
            : 'On this computer · No AI needed'}
        </span>
      </div>
      <div className="organization-tabs">
        {organizerTemplates.slice(0, 2).map((t) => {
          const Icon = marks[t.id] || FolderSearch;
          return (
            <button
              key={t.id}
              disabled={locked}
              className={options.template === t.id ? 'chosen' : ''}
              onClick={() => choose(t.id)}
            >
              <Icon size={17} />
              {t.name}
            </button>
          );
        })}
        <label className="organization-template-picker">
          Other tools{' '}
          <select
            aria-label="Organizer template"
            value={options.template}
            disabled={locked}
            onChange={(e) => choose(e.target.value as OrganizerTemplate)}
          >
            {[false, true].map((ai) => (
              <optgroup key={String(ai)} label={ai ? 'AI tools' : 'File tools'}>
                {organizerTemplates
                  .filter((t) => !!t.ai === ai)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <div className="organization-error" role="alert">
          {error}
        </div>
      )}
      <div className="organization-setup">
        <div className="organization-panel">
          <div className="organization-step">
            <b>1</b>
            <h2>Choose your files</h2>
          </div>
          <p>
            System folders, linked files, dot folders, and recognized code projects are skipped. Add
            a <code>.relay-preserve</code> file inside any folder you want kept together.
          </p>
          <label>Folder or drive</label>
          <div className="organization-path">
            <span title={root}>{root || 'Choose a personal folder or data drive'}</span>
            <button disabled={locked} onClick={() => browse('root')}>
              Browse source
            </button>
          </div>
          <label className="organization-check">
            <input
              type="checkbox"
              checked={recursive}
              disabled={locked}
              onChange={(e) => {
                setRecursive(e.target.checked);
                setScanDirty(true);
                setDirty(true);
              }}
            />
            Include subfolders
          </label>
          <div className="organization-exclusions">
            <button disabled={locked} onClick={() => browse('exclude')}>
              + Exclude a folder
            </button>
            {options.exclude.map((folder) => (
              <span key={folder} title={folder}>
                {filename(folder)}
                <button
                  aria-label={`Remove exclusion ${folder}`}
                  disabled={locked}
                  onClick={() => {
                    change({ exclude: options.exclude.filter((p) => p !== folder) });
                    setScanDirty(true);
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <button
            className="primary organization-action"
            disabled={locked || !root}
            onClick={() =>
              act(async () => {
                await api.organizerScan({ root, recursive, exclude: options.exclude });
                setScanDirty(false);
                setDirty(true);
              })
            }
          >
            <FolderSearch size={17} />
            Scan files
          </button>
          {scan?.status === 'limited' && !scanDirty && (
            <button
              className="organization-action"
              disabled={locked}
              onClick={() => act(() => api.organizerResumeScan())}
            >
              Continue scan · {scan.pendingFolders?.length || 0} folders left
            </button>
          )}
        </div>
        <div className="organization-panel">
          <div className="organization-step">
            <b>2</b>
            <h2>{template.name}</h2>
          </div>
          <p>{template.description}</p>
          {smart ? (
            <>
              <label>Where should files go?</label>
              <select
                aria-label="Organization placement"
                disabled={locked}
                value={options.placement || 'inside'}
                onChange={(e) => change({ placement: e.target.value as PlanOptions['placement'] })}
              >
                <option value="inside">Create folders inside this location</option>
                <option value="subfolder">Create one organized subfolder</option>
                <option value="elsewhere">Use another folder</option>
              </select>
              {options.placement === 'subfolder' && (
                <label>
                  New subfolder name
                  <input
                    aria-label="New subfolder name"
                    disabled={locked}
                    value={options.subfolderName || ''}
                    onChange={(e) => change({ subfolderName: e.target.value })}
                  />
                </label>
              )}
              {options.placement === 'elsewhere' && (
                <div className="organization-path">
                  <span title={options.destination}>
                    {options.destination || 'Choose another folder'}
                  </span>
                  <button disabled={locked} onClick={() => browse('destination')}>
                    Browse destination
                  </button>
                </div>
              )}
              <label className="organization-check">
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={options.renameSmart !== false}
                  onChange={(e) => change({ renameSmart: e.target.checked })}
                />
                Suggest cleaner names when a pattern is clear
              </label>
              <p className="organization-hint">
                Relay groups episodes and subtitles, pictures, screenshots, documents, audio,
                archives, and installers. Unknown types wait for your review.
              </p>
            </>
          ) : options.template === 'rename' ? (
            <>
              <label htmlFor="rename-pattern">Name pattern</label>
              <input
                id="rename-pattern"
                disabled={locked}
                value={options.pattern}
                onChange={(e) => change({ pattern: e.target.value })}
              />
              <p className="organization-hint">
                {
                  '{{stem}} original name · {{ext}} extension · {{name}} full name · {{date}} modified date · {{number}} sequence'
                }
              </p>
            </>
          ) : (
            <>
              <label>Destination folder</label>
              <div className="organization-path">
                <span title={options.destination}>
                  {options.destination || 'Choose where organized files will go'}
                </span>
                <button disabled={locked} onClick={() => browse('destination')}>
                  Browse destination
                </button>
              </div>
              <div className="organization-inline">
                <label>
                  Action{' '}
                  <select
                    aria-label="File action"
                    disabled={locked || copyOnly}
                    value={copyOnly ? 'copy' : options.operation}
                    onChange={(e) => change({ operation: e.target.value as 'copy' | 'move' })}
                  >
                    <option value="copy">Copy · keep originals</option>
                    <option value="move">Move · remove originals</option>
                  </select>
                </label>
                <label className="organization-check">
                  <input
                    disabled={
                      locked || !['drive', 'downloads', 'photos'].includes(options.template)
                    }
                    type="checkbox"
                    checked={options.preserveStructure}
                    onChange={(e) => change({ preserveStructure: e.target.checked })}
                  />
                  Keep folder structure
                </label>
              </div>
            </>
          )}
          {['storage', 'archive', 'cleanup'].includes(options.template) && (
            <div className="organization-advanced">
              <label>
                Older than (days)
                <input
                  aria-label="Older than days"
                  type="number"
                  min="0"
                  max="36500"
                  value={options.olderThanDays ?? 90}
                  disabled={locked}
                  onChange={(e) => change({ olderThanDays: Number(e.target.value) })}
                />
              </label>
              {['storage', 'cleanup'].includes(options.template) && (
                <label>
                  At least (MB)
                  <input
                    aria-label="Minimum size MB"
                    type="number"
                    min="0"
                    value={options.minSizeMB ?? 100}
                    disabled={locked}
                    onChange={(e) => change({ minSizeMB: Number(e.target.value) })}
                  />
                </label>
              )}
            </div>
          )}
          {options.template === 'duplicates' && (
            <div className="organization-exclusions">
              <button disabled={locked} onClick={() => browse('keeper')}>
                Choose preferred keep folder
              </button>
              <span title={options.keepFolder}>
                {options.keepFolder || 'Keep the first relative path in each group'}
                {options.keepFolder && (
                  <button disabled={locked} onClick={() => change({ keepFolder: '' })}>
                    ×
                  </button>
                )}
              </span>
            </div>
          )}
          {copyOnly && (
            <p className="organization-hint">
              This template keeps originals. Generated files and backup repairs never overwrite
              existing files.
            </p>
          )}
          {usesAI && (
            <div className="organization-ai-settings">
              <p>
                Building this review reads document text and asks the model configured in AI
                connections. Cloud providers receive that text and may charge for requests. You will
                confirm the provider before analysis starts. OCR is local and currently reads
                English.
              </p>
              <label>
                {smart
                  ? 'AI document topics are suggested automatically'
                  : 'Allowed categories / project names'}
                <input
                  aria-label="Allowed AI categories"
                  value={options.labels ?? ''}
                  disabled={locked || smart}
                  onChange={(e) => change({ labels: e.target.value })}
                />
              </label>
              <div className="organization-advanced">
                <label>
                  File / request limit
                  <input
                    aria-label="AI request limit"
                    type="number"
                    min="1"
                    max="100"
                    value={options.maxAIRequests ?? 20}
                    disabled={locked}
                    onChange={(e) => change({ maxAIRequests: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Characters per file
                  <input
                    aria-label="AI character limit"
                    type="number"
                    min="500"
                    max="60000"
                    value={options.maxCharacters ?? 20000}
                    disabled={locked}
                    onChange={(e) => change({ maxCharacters: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Minimum confidence
                  <input
                    aria-label="AI confidence threshold"
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={options.minConfidence ?? 0.8}
                    disabled={locked}
                    onChange={(e) => change({ minConfidence: Number(e.target.value) })}
                  />
                </label>
              </div>
              <label className="organization-check">
                <input
                  type="checkbox"
                  checked={options.ocr !== false}
                  disabled={locked}
                  onChange={(e) => change({ ocr: e.target.checked })}
                />
                Use local OCR for images and scanned PDF pages
              </label>
            </div>
          )}
          {usesAI && (
            <button
              className="organization-action"
              disabled={locked}
              onClick={() => act(() => api.organizerClearCache())}
            >
              Clear cached AI results
            </button>
          )}
          <div className="organization-categories">
            {fileCategories.map((category) => (
              <label key={category}>
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={options.categories.includes(category)}
                  onChange={(e) =>
                    change({
                      categories: e.target.checked
                        ? [...options.categories, category]
                        : options.categories.filter((c) => c !== category),
                    })
                  }
                />
                {category}
              </label>
            ))}
          </div>
          <button
            className="organization-action"
            disabled={
              locked ||
              !scan ||
              scanDirty ||
              scan.root !== root ||
              (scan.status !== 'complete' && !(smart && scan.status === 'limited')) ||
              (!options.destination &&
                options.template !== 'rename' &&
                (!smart || options.placement === 'elsewhere'))
            }
            onClick={() =>
              act(async () => {
                const built = await api.organizerPlan(options);
                if (!built) return;
                setDirty(false);
                setReviewed(false);
                setSearch('');
              })
            }
          >
            Build review <ArrowRight size={16} />
          </button>
        </div>
      </div>
      {progress && (
        <div className="organization-progress" role="status">
          <span className="organization-pulse" />
          <strong>{progress.stage}</strong>
          <span>
            {progress.count.toLocaleString()}
            {progress.total !== undefined ? ` / ${progress.total.toLocaleString()}` : ' files'}
          </span>
          <span className="organization-progress-path" title={progress.path}>
            {progress.path}
          </span>
          <button onClick={() => void api.cancel()}>Cancel</button>
        </div>
      )}
      {scan && (
        <div className="organization-scan">
          <div>
            <strong>{scan.files.length.toLocaleString()}</strong>
            <span>files found</span>
          </div>
          <div>
            <strong>{bytes(scan.bytes)}</strong>
            <span>total size</span>
          </div>
          <div>
            <strong>{scan.skipped.toLocaleString()}</strong>
            <span>entries skipped</span>
          </div>
          <div>
            <strong>{scanDirty ? 'Scan again' : scan.status}</strong>
            <span title={scan.root}>{scan.root}</span>
          </div>
          <details>
            <summary>Scan details</summary>
            <p>
              Saved {new Date(scan.createdAt).toLocaleString()}. The photo date rule uses file
              modification time. Large scans pause between completed folders near 50,000 files or
              200,000 entries. Review this section, then continue with pending folders.
            </p>
            <div className="organization-breakdown">
              {fileCategories.map((c) => (
                <span key={c}>
                  {c}: {scan.files.filter((f) => f.category === c).length}
                </span>
              ))}
            </div>
            {scan.warnings.length > 0 && (
              <ul>
                {scan.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            )}
          </details>
        </div>
      )}
      {plan && (
        <div className="organization-review">
          <div className="organization-review-heading">
            <div className="organization-step">
              <b>3</b>
              <div>
                <h2>{ready ? 'Review your changes' : 'Batch record'}</h2>
                <p>
                  {organizerTemplates.find((t) => t.id === plan.options.template)?.name} ·{' '}
                  {plan.options.operation} · <strong>{plan.status}</strong>
                </p>
              </div>
            </div>
            <span>
              {plan.items.length.toLocaleString()} proposed · {conflictCount} conflicts
            </span>
          </div>
          {ready && dirty && (
            <div className="organization-warning">
              The setup changed. Build a new review before applying changes.
            </div>
          )}
          {plan.error && (
            <div className="organization-error" role="alert">
              {plan.error}
            </div>
          )}
          {!!plan.notes?.length && (
            <details className="organization-analysis" open={!!plan.analysis || !plan.items.length}>
              <summary>Analysis notes ({plan.notes.length})</summary>
              <ul>
                {plan.notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </details>
          )}
          {ready &&
            (smart || ['cleanup', 'delivery'].includes(options.template)) &&
            !!groups.length && (
              <div className="organization-groups">
                <h3>Proposed groups</h3>
                {groups.map(([name, items]) => (
                  <article key={name}>
                    <div>
                      <strong>{name}</strong>
                      <small>
                        {items.length} files · {items.filter((item) => item.issue).length} conflicts
                      </small>
                    </div>
                    <button
                      disabled={locked}
                      onClick={() => {
                        setSelected(
                          (previous) =>
                            new Set([
                              ...previous,
                              ...items.filter((item) => !item.issue).map((item) => item.id),
                            ]),
                        );
                        setReviewed(false);
                      }}
                    >
                      Include group
                    </button>
                    <button
                      disabled={locked}
                      onClick={() => {
                        setSelected((previous) => {
                          const next = new Set(previous);
                          items.forEach((item) => next.delete(item.id));
                          return next;
                        });
                        setReviewed(false);
                      }}
                    >
                      Skip group
                    </button>
                  </article>
                ))}
              </div>
            )}
          <div className="organization-table-tools">
            <input
              aria-label="Search changes"
              placeholder="Search a name, path, or state…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
            {ready && (
              <>
                <button
                  disabled={locked}
                  onClick={() => {
                    setSelected(new Set(plan.items.filter((i) => !i.issue).map((i) => i.id)));
                    setReviewed(false);
                  }}
                >
                  Select eligible
                </button>
                <button
                  disabled={locked}
                  onClick={() => {
                    setSelected(new Set());
                    setReviewed(false);
                  }}
                >
                  Clear selection
                </button>
                <button
                  disabled={locked || dirty}
                  onClick={() =>
                    act(async () => {
                      await api.organizerSelect([...selected]);
                      setReviewed(false);
                    })
                  }
                >
                  Save selection
                </button>
              </>
            )}
          </div>
          <div className="organization-table-wrap">
            <table>
              <thead>
                <tr>
                  <th aria-label="Selected" />
                  <th>Current file</th>
                  <th>Proposed location</th>
                  <th>Why / state</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(page * 75, (page + 1) * 75).map((item) => (
                  <tr key={item.id} className={item.issue ? 'has-conflict' : ''}>
                    <td>
                      <input
                        aria-label={`Include ${item.source}`}
                        type="checkbox"
                        disabled={locked || !ready || !!item.issue}
                        checked={selected.has(item.id) && !item.issue}
                        onChange={() => toggle(item.id)}
                      />
                    </td>
                    <td>
                      <strong>{filename(item.source)}</strong>
                      <small>{item.source}</small>
                      <small>{bytes(item.stamp.size)}</small>
                    </td>
                    <td>
                      <strong>{filename(item.destination)}</strong>
                      <small>{item.destination}</small>
                    </td>
                    <td>
                      {item.issue || item.error || item.reason}
                      <small>
                        {item.action || plan.options.operation} · {item.state}
                      </small>
                      {item.content !== undefined && (
                        <details className="organization-content">
                          <summary>Preview generated file</summary>
                          <pre>{item.content}</pre>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && (
              <p className="organization-empty">
                {plan.items.length
                  ? 'No matching changes.'
                  : 'No changes match these rules. Choose other file types or adjust the naming pattern.'}
              </p>
            )}
          </div>
          <div className="organization-pagination">
            <span>
              {filtered.length
                ? `${page * 75 + 1}–${Math.min((page + 1) * 75, filtered.length)} of ${filtered.length}`
                : '0 changes'}{' '}
              · Conflicting destinations are excluded; existing files are never overwritten.
            </span>
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <button
              disabled={(page + 1) * 75 >= filtered.length}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
          <div className="organization-apply">
            {ready ? (
              <>
                <div>
                  <strong>
                    {count.toLocaleString()} selected · {bytes(selectedBytes)}
                  </strong>
                  <label className="organization-check">
                    <input
                      aria-label="I reviewed the selected changes"
                      type="checkbox"
                      checked={reviewed}
                      disabled={locked || dirty || !count}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />
                    I reviewed the selected changes
                  </label>
                </div>
                <button
                  className="primary"
                  disabled={locked || dirty || !reviewed || !count}
                  onClick={() =>
                    act(async () => {
                      await api.organizerSelect([...selected]);
                      await api.organizerApply();
                    })
                  }
                >
                  Apply selected changes <ArrowRight size={16} />
                </button>
              </>
            ) : (
              <>
                <p>
                  {plan.items.filter((i) => i.state === 'done').length} completed ·{' '}
                  {plan.items.filter((i) => i.state === 'undone').length} undone. Undo checks file
                  contents and stops on conflicts.
                </p>
                <button
                  disabled={
                    locked ||
                    plan.status === 'undone' ||
                    !plan.items.some((i) =>
                      [
                        'done',
                        'copied',
                        'restored',
                        'copying',
                        'removing',
                        'restoring',
                        'undo-removing',
                      ].includes(i.state),
                    )
                  }
                  onClick={() => act(() => api.organizerUndo())}
                >
                  <Undo2 size={16} />
                  Undo batch
                </button>
              </>
            )}
          </div>
        </div>
      )}
      <details className="organization-presets">
        <summary>Save this workflow & schedule reviews</summary>
        <p>
          Reuse these folders and rules. Scheduled runs prepare a review while Relay is open; they
          never apply file changes. Missed intervals become one review after reopening. AI analysis
          stays manual.
        </p>
        <div className="organization-advanced">
          <label>
            Workflow name
            <input
              aria-label="Saved organizer name"
              value={presetName}
              maxLength={80}
              disabled={locked}
              onChange={(e) => setPresetName(e.target.value)}
            />
          </label>
          <label>
            Every (hours)
            <input
              aria-label="Review interval hours"
              type="number"
              min="1"
              max="8760"
              value={everyHours}
              disabled={locked || usesAI}
              onChange={(e) => setEveryHours(Number(e.target.value))}
            />
          </label>
        </div>
        <label className="organization-check">
          <input
            type="checkbox"
            aria-label="Schedule automatic reviews"
            checked={scheduled && !usesAI}
            disabled={locked || usesAI}
            onChange={(e) => setScheduled(e.target.checked)}
          />
          Prepare reviews on this schedule while Relay is open
        </label>
        <button
          className="organization-action"
          disabled={
            locked ||
            !presetName.trim() ||
            !root ||
            (!options.destination &&
              options.template !== 'rename' &&
              (!smart || options.placement === 'elsewhere'))
          }
          onClick={() =>
            act(async () => {
              await api.organizerSavePreset({
                name: presetName,
                scan: { root, recursive, exclude: options.exclude },
                options,
                everyHours,
                enabled: scheduled && !usesAI,
              });
              setPresetName('');
            })
          }
        >
          Save workflow setup
        </button>
        <div className="organization-preset-list">
          {state?.presets?.map((preset) => (
            <article key={preset.id}>
              <div>
                <strong>{preset.name}</strong>
                <p>
                  {organizerTemplates.find((t) => t.id === preset.options.template)?.name} ·{' '}
                  {preset.enabled
                    ? `Every ${preset.everyHours} hours · next ${new Date(preset.nextRun).toLocaleString()}`
                    : 'Manual reviews'}
                </p>
                {preset.error && <p className="organization-preset-error">{preset.error}</p>}
              </div>
              <div>
                <button
                  disabled={locked}
                  onClick={() => {
                    setRoot(preset.scan.root);
                    setRecursive(preset.scan.recursive);
                    setOptions(preset.options);
                    setDirty(true);
                    setScanDirty(true);
                    setReviewed(false);
                  }}
                >
                  Load setup
                </button>
                <button
                  disabled={locked}
                  onClick={() =>
                    act(async () => {
                      await api.organizerRunPreset(preset.id);
                      const next = await api.organizerState();
                      if (next.plan) {
                        setRoot(next.plan.root);
                        setOptions(next.plan.options);
                        setDirty(false);
                        setScanDirty(false);
                        setReviewed(false);
                      }
                    })
                  }
                >
                  Prepare review now
                </button>
                {!needsAI(preset.options.template) && (
                  <button
                    disabled={locked}
                    onClick={() =>
                      act(() => api.organizerSavePreset({ ...preset, enabled: !preset.enabled }))
                    }
                  >
                    {preset.enabled ? 'Pause schedule' : 'Enable schedule'}
                  </button>
                )}
                <button
                  disabled={locked}
                  onClick={() => act(() => api.organizerRemovePreset(preset.id))}
                >
                  Remove setup
                </button>
              </div>
            </article>
          ))}
        </div>
      </details>
      {!!state?.history.length && (
        <details className="organization-history">
          <summary>Saved plans & batches ({state.history.length})</summary>
          <div>
            {state.history.map((entry) => (
              <button
                disabled={locked}
                key={entry.id}
                onClick={() =>
                  act(async () => {
                    await api.organizerLoad(entry.id);
                    const next = await api.organizerState();
                    if (next.plan) {
                      setOptions(next.plan.options);
                      setRoot(next.plan.root);
                      setDirty(false);
                      setScanDirty(next.scan?.root !== next.plan.root);
                      setSearch('');
                    }
                  })
                }
              >
                <span>{organizerTemplates.find((t) => t.id === entry.template)?.name}</span>
                <span>
                  {entry.count} changes · {entry.status}
                </span>
                <small>{new Date(entry.createdAt).toLocaleString()}</small>
              </button>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
