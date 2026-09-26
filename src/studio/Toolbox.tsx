import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clipboard,
  Copy,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  LoaderCircle,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  toolboxTools,
  type ToolboxInput,
  type ToolboxProgress,
  type ToolboxResult,
  type ToolboxToolId,
} from '../shared/toolbox';
import './toolbox.css';

const api = window.studio;
const basename = (value: string) => value.split(/[\\/]/).pop() || value;
const bytes = (value: number) =>
  value < 1024
    ? `${value} B`
    : value < 1024 ** 2
      ? `${(value / 1024).toFixed(1)} KB`
      : `${(value / 1024 ** 2).toFixed(1)} MB`;
const friendlyError = (error: unknown) =>
  String((error as Error).message || error).replace(
    /^Error invoking remote method '[^']+': Error: /,
    '',
  );
const imageFile = (file: string) => /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(file);

export function Toolbox({
  view,
  openOrganizer,
}: {
  view: 'home' | 'tools' | 'activity';
  openOrganizer: (template: 'smart' | 'duplicates' | 'backup' | 'rename') => void;
}) {
  const [tool, setTool] = useState<ToolboxToolId | null>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [inputText, setInputText] = useState('');
  const [editableText, setEditableText] = useState('');
  const [width, setWidth] = useState(1600);
  const [format, setFormat] = useState<'jpeg' | 'png' | 'webp'>('jpeg');
  const [pages, setPages] = useState('1');
  const [result, setResult] = useState<ToolboxResult | null>(null);
  const [history, setHistory] = useState<ToolboxResult[]>([]);
  const [progress, setProgress] = useState<ToolboxProgress | null>(null);
  const [preview, setPreview] = useState('');
  const [resultPreview, setResultPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const current = toolboxTools.find((entry) => entry.id === tool);
  const matching = useMemo(
    () =>
      toolboxTools.filter(
        (entry) =>
          (category === 'All' || entry.category === category) &&
          `${entry.title} ${entry.description} ${entry.category}`
            .toLowerCase()
            .includes(query.toLowerCase().trim()),
      ),
    [query, category],
  );

  useEffect(() => {
    void api
      .toolboxHistory()
      .then(setHistory)
      .catch(() => {});
    return api.onToolboxProgress(setProgress);
  }, []);
  useEffect(() => {
    setTool(null);
    setPaths([]);
    setResult(null);
    setError('');
  }, [view]);
  useEffect(() => {
    const file = paths.find(imageFile);
    if (!file) {
      setPreview('');
      return;
    }
    let active = true;
    void api
      .toolboxPreview(file)
      .then((value) => {
        if (active) setPreview(value);
      })
      .catch(() => {
        if (active) setPreview('');
      });
    return () => {
      active = false;
    };
  }, [paths]);
  useEffect(() => {
    const file = result?.outputs.find((item) => imageFile(item.path))?.path;
    if (!file) {
      setResultPreview('');
      return;
    }
    let active = true;
    void api
      .toolboxPreview(file)
      .then((value) => {
        if (active) setResultPreview(value);
      })
      .catch(() => {
        if (active) setResultPreview('');
      });
    return () => {
      active = false;
    };
  }, [result]);

  function choose(id: ToolboxToolId, keepPaths = false) {
    setTool(id);
    setResult(null);
    setEditableText('');
    setError('');
    if (!keepPaths || id === 'text-clean') setPaths([]);
  }
  async function pick() {
    try {
      const selected = await api.toolboxPick();
      if (selected.length) {
        setPaths(selected);
        setResult(null);
        setError('');
        if (!tool)
          choose(
            selected.every(imageFile)
              ? 'image-smaller'
              : selected.every((file) => /\.pdf$/i.test(file))
                ? 'pdf-merge'
                : 'text-extract',
            true,
          );
      }
    } catch (reason) {
      setError(friendlyError(reason));
    }
  }
  async function receiveDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    try {
      const selected = await api.toolboxDropped(Array.from(event.dataTransfer.files));
      if (!selected.length) throw new Error('Drop regular files into Relay.');
      setPaths(selected);
      setResult(null);
      setError('');
      if (!tool)
        choose(
          selected.every(imageFile)
            ? 'image-smaller'
            : selected.every((file) => /\.pdf$/i.test(file))
              ? 'pdf-merge'
              : 'text-extract',
          true,
        );
    } catch (reason) {
      setError(friendlyError(reason));
    }
  }
  function reorder(index: number, direction: -1 | 1) {
    setPaths((previous) => {
      const next = [...previous],
        other = index + direction;
      if (other < 0 || other >= next.length) return previous;
      [next[index], next[other]] = [next[other], next[index]];
      return next;
    });
  }
  async function run() {
    if (!tool) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const input: ToolboxInput = {
        id: tool,
        paths,
        text: inputText,
        width: tool === 'image-resize' ? width : undefined,
        format: tool === 'image-convert' ? format : undefined,
        pages: tool === 'pdf-extract' ? pages : undefined,
      };
      const next = await api.toolboxRun(input);
      setResult(next);
      setEditableText(next.text || '');
      setHistory(await api.toolboxHistory());
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await api.toolboxCopy(editableText);
      setError('');
    } catch (reason) {
      setError(friendlyError(reason));
    }
  }
  async function open(file: string, reveal: boolean) {
    try {
      await api.toolboxOpen(file, reveal);
    } catch (reason) {
      setError(friendlyError(reason));
    }
  }

  if (tool && current)
    return (
      <main
        className="toolbox-page"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => void receiveDrop(event)}
      >
        <button
          className="toolbox-back"
          onClick={() => {
            setTool(null);
            setPaths([]);
            setResult(null);
            setError('');
          }}
        >
          <ArrowLeft size={17} /> All tools
        </button>
        <div className="toolbox-heading">
          <span className="toolbox-kicker">{current.category}</span>
          <h1>{current.title}</h1>
          <p>{current.description}</p>
        </div>
        <div className="toolbox-workspace">
          <section className="toolbox-panel">
            <h2>{current.accepts === 'text' ? 'Paste your text' : 'Your files'}</h2>
            {current.accepts === 'text' ? (
              <textarea
                className="toolbox-textarea"
                aria-label="Text to clean"
                placeholder="Paste text here"
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
              />
            ) : (
              <>
                <button className="toolbox-picker" onClick={() => void pick()} disabled={busy}>
                  <Plus size={20} />{' '}
                  <strong>{paths.length ? 'Choose different files' : 'Choose files'}</strong>
                  <span>or drop files anywhere on this page</span>
                </button>
                {paths.length > 0 && (
                  <div className="toolbox-input-list">
                    {paths.map((file, index) => (
                      <div className="toolbox-input" key={`${file}-${index}`}>
                        {imageFile(file) ? <ImageIcon size={17} /> : <FileText size={17} />}
                        <span title={file}>{basename(file)}</span>
                        {['pdf-merge', 'pdf-from-images'].includes(tool) && (
                          <>
                            <button
                              aria-label={`Move ${basename(file)} up`}
                              disabled={index === 0}
                              onClick={() => reorder(index, -1)}
                            >
                              ↑
                            </button>
                            <button
                              aria-label={`Move ${basename(file)} down`}
                              disabled={index === paths.length - 1}
                              onClick={() => reorder(index, 1)}
                            >
                              ↓
                            </button>
                          </>
                        )}
                        <button
                          aria-label={`Remove ${basename(file)}`}
                          onClick={() =>
                            setPaths(paths.filter((_, position) => position !== index))
                          }
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {preview && (
                  <img
                    className="toolbox-preview"
                    src={preview}
                    alt={`Preview of ${basename(paths.find(imageFile) || '')}`}
                  />
                )}
              </>
            )}
            {tool === 'image-resize' && (
              <label className="toolbox-option">
                Maximum width{' '}
                <input
                  type="number"
                  min="200"
                  max="8000"
                  value={width}
                  onChange={(event) => setWidth(Number(event.target.value))}
                />{' '}
                pixels
              </label>
            )}
            {tool === 'image-convert' && (
              <label className="toolbox-option">
                New format{' '}
                <select
                  value={format}
                  onChange={(event) => setFormat(event.target.value as typeof format)}
                >
                  <option value="jpeg">JPG</option>
                  <option value="png">PNG</option>
                  <option value="webp">WebP</option>
                </select>
              </label>
            )}
            {tool === 'pdf-extract' && (
              <label className="toolbox-option">
                Pages to save{' '}
                <input
                  aria-label="Pages to save"
                  placeholder="1-3,5"
                  value={pages}
                  onChange={(event) => setPages(event.target.value)}
                />
              </label>
            )}
            {tool.startsWith('image-') && (
              <p className="toolbox-note">
                New copies may omit original picture metadata. JPG uses a white background for
                transparent pictures.
              </p>
            )}
            {tool !== 'text-clean' && tool !== 'text-extract' && (
              <p className="toolbox-note">
                Originals stay where they are. Results go to Documents / Relay Results.
              </p>
            )}
            <button
              className="toolbox-run"
              onClick={() => void run()}
              disabled={busy || (current.accepts === 'text' ? !inputText.trim() : !paths.length)}
            >
              {busy ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}
              {busy ? 'Working…' : tool === 'text-clean' ? 'Clean text' : 'Create result'}
            </button>
            {progress && (
              <p role="status" className="toolbox-progress">
                {progress.completed} of {progress.total} · {progress.label}
              </p>
            )}
            {error && (
              <p className="toolbox-error" role="alert">
                {error}
              </p>
            )}
          </section>
          <section className="toolbox-panel toolbox-results">
            <h2>Result</h2>
            {!result && <p>Choose your files and run this tool. Your result will appear here.</p>}
            {result && (
              <>
                <p className="toolbox-success">
                  <Check size={17} />{' '}
                  {result.outputs.length
                    ? `${result.outputs.length} file${result.outputs.length === 1 ? '' : 's'} created`
                    : result.text
                      ? 'Text ready'
                      : 'No new files created'}
                </p>
                {resultPreview && (
                  <img
                    className="toolbox-preview"
                    src={resultPreview}
                    alt="Result picture preview"
                  />
                )}
                {result.inputBytes && result.outputs.length > 0 && (
                  <p>
                    {bytes(result.inputBytes)} in →{' '}
                    {bytes(result.outputs.reduce((sum, item) => sum + item.bytes, 0))} out
                  </p>
                )}
                {result.outputs.map((item) => (
                  <div className="toolbox-output" key={item.path}>
                    <FileText size={18} />
                    <div>
                      <strong>{basename(item.path)}</strong>
                      <small>{bytes(item.bytes)}</small>
                    </div>
                    <button onClick={() => void open(item.path, false)}>Open</button>
                    <button onClick={() => void open(item.path, true)}>
                      <FolderOpen size={15} /> Folder
                    </button>
                  </div>
                ))}
                {result.text !== undefined && (
                  <>
                    <textarea
                      className="toolbox-textarea"
                      aria-label="Extracted or cleaned text"
                      value={editableText}
                      onChange={(event) => setEditableText(event.target.value)}
                    />
                    <button className="toolbox-secondary" onClick={() => void copy()}>
                      <Copy size={16} /> Copy text
                    </button>
                  </>
                )}
                {result.errors.length > 0 && (
                  <div className="toolbox-issues">
                    <strong>
                      {result.errors.length} item{result.errors.length === 1 ? '' : 's'} need
                      attention
                    </strong>
                    {result.errors.map((item, index) => (
                      <p key={index}>{item}</p>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    );

  if (view === 'activity')
    return (
      <main className="toolbox-page">
        <div className="toolbox-heading">
          <span className="toolbox-kicker">ACTIVITY</span>
          <h1>Recent results</h1>
          <p>Open finished files or see where Relay saved them.</p>
        </div>
        {!history.length && <div className="toolbox-empty">Finished tools will appear here.</div>}
        {history.map((entry) => (
          <article className="toolbox-history" key={entry.id}>
            <div>
              <strong>
                {toolboxTools.find((item) => item.id === entry.tool)?.title || entry.tool}
              </strong>
              <small>
                {new Date(entry.createdAt).toLocaleString()} · {entry.outputs.length} file
                {entry.outputs.length === 1 ? '' : 's'}
              </small>
            </div>
            {entry.outputs[0] && (
              <button onClick={() => void open(entry.outputs[0].path, true)}>Show in folder</button>
            )}
          </article>
        ))}
      </main>
    );

  const featured =
    view === 'home'
      ? toolboxTools.filter((entry) =>
          ['image-smaller', 'pdf-from-images', 'pdf-merge', 'text-extract', 'text-clean'].includes(
            entry.id,
          ),
        )
      : matching;
  return (
    <main className="toolbox-page">
      <div className="toolbox-heading">
        <span className="toolbox-kicker">
          {view === 'home' ? 'YOUR DESKTOP TOOLBOX' : 'BROWSE TOOLS'}
        </span>
        <h1>{view === 'home' ? 'What do you need to do?' : 'All tools'}</h1>
        <p>Pick a tool, or drop files here to get started. No setup needed for local tools.</p>
      </div>
      {view === 'home' && (
        <div className="toolbox-launchpad">
          <button className="toolbox-organize-feature" onClick={() => openOrganizer('smart')}>
            <div>
              <span className="toolbox-kicker">FILE ORGANIZER</span>
              <h2>Give your files a home.</h2>
              <p>Choose a location. See related collections. Organize with one clear action.</p>
              <span className="toolbox-feature-action">
                Organize a folder <ArrowRight size={17} />
              </span>
            </div>
            <div className="toolbox-folder-art" aria-hidden="true">
              <div>
                <FolderOpen size={18} /> Downloads
              </div>
              <span>
                <Folder size={16} /> Pictures
              </span>
              <span>
                <Folder size={16} /> Series & subtitles
              </span>
              <span>
                <Folder size={16} /> Documents
              </span>
              <small>
                <Layers size={14} /> Related files stay together
              </small>
            </div>
          </button>
          <div
            className="toolbox-drop"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => void receiveDrop(event)}
          >
            <div className="toolbox-drop-icon">
              <Plus size={25} />
            </div>
            <div>
              <strong>Work on a file</strong>
              <span>
                Drop pictures, PDFs, or documents.
                <br />
                Relay suggests a tool.
              </span>
            </div>
            <button onClick={() => void pick()}>
              Choose files <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="toolbox-error" role="alert">
          {error}
        </p>
      )}
      {view === 'tools' && (
        <>
          <label className="toolbox-search">
            <Search size={17} />
            <input
              aria-label="Find a tool"
              placeholder="Find a tool, like PDF or pictures"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="toolbox-categories">
            {['All', ...new Set(toolboxTools.map((entry) => entry.category))].map((name) => (
              <button
                key={name}
                className={category === name ? 'active' : ''}
                onClick={() => setCategory(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="toolbox-section-heading">
        <h2>{view === 'home' ? 'Start here' : 'Available tools'}</h2>
        <span>{featured.length} tools</span>
      </div>
      <div className="toolbox-grid">
        {featured.map((entry) => (
          <button className="toolbox-card" key={entry.id} onClick={() => choose(entry.id)}>
            <span className="toolbox-card-icon">
              {entry.category === 'Images' ? (
                <ImageIcon />
              ) : entry.category === 'PDFs' ? (
                <FileText />
              ) : (
                <Clipboard />
              )}
            </span>
            <span className="toolbox-card-type">{entry.category}</span>
            <strong>{entry.title}</strong>
            <p>{entry.description}</p>
            <span className="toolbox-card-action">
              Open tool <ArrowRight size={15} />
            </span>
          </button>
        ))}
      </div>
      <div className="toolbox-section-heading">
        <h2>Files and storage</h2>
        <span>Organize, compare, and review</span>
      </div>
      <div className="toolbox-grid">
        {[
          ...(view === 'tools'
            ? [
                [
                  'Organize a location',
                  'Collections, remembered filing choices, and library search.',
                  'smart',
                ],
              ]
            : []),
          [
            'Find exact duplicates',
            'Compare matching files and choose extras to archive.',
            'duplicates',
          ],
          ['Compare folders', 'Check a backup and copy missing files.', 'backup'],
          [
            'Rename selected files',
            'Choose a pattern and review names before changing them.',
            'rename',
          ],
        ].map(([title, description, template]) => (
          <button
            className="toolbox-card"
            key={template}
            onClick={() => openOrganizer(template as 'smart' | 'duplicates' | 'backup' | 'rename')}
          >
            <span className="toolbox-card-icon">
              <FolderOpen />
            </span>
            <span className="toolbox-card-type">FILES</span>
            <strong>{title}</strong>
            <p>{description}</p>
            <span className="toolbox-card-action">
              Open tool <ArrowRight size={15} />
            </span>
          </button>
        ))}
      </div>
      {view === 'home' && history.length > 0 && (
        <>
          <div className="toolbox-section-heading">
            <h2>Recent results</h2>
          </div>
          {history.slice(0, 3).map((entry) => (
            <article className="toolbox-history" key={entry.id}>
              <div>
                <strong>
                  {toolboxTools.find((item) => item.id === entry.tool)?.title || entry.tool}
                </strong>
                <small>{new Date(entry.createdAt).toLocaleString()}</small>
              </div>
              {entry.outputs[0] && (
                <button onClick={() => void open(entry.outputs[0].path, true)}>
                  Show in folder
                </button>
              )}
            </article>
          ))}
        </>
      )}
    </main>
  );
}
