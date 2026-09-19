import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type NodeProps,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Cloud,
  Clock3,
  Copy,
  FileInput,
  FilePenLine,
  FileText,
  Folder,
  FolderInput,
  GitBranch,
  Layers3,
  LayoutGrid,
  LoaderCircle,
  MoreHorizontal,
  MousePointer2,
  Pause,
  Play,
  Plus,
  Radio,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Upload,
  Workflow as WorkflowIcon,
  X,
  Zap,
} from 'lucide-react';
import type {
  AISettings,
  CloudSettings,
  Kind,
  Run,
  Snapshot,
  Step,
  Workflow,
} from '../shared/types';
import { blankWorkflow, catalog, templates } from '../shared/catalog';
import { Organizer, OrganizerCards } from './Organizer';
import type { OrganizerTemplate } from '../shared/organizer';
const icons = {
  trigger: FolderInput,
  filter: GitBranch,
  read: FileText,
  ai: Sparkles,
  rename: FilePenLine,
  copy: Copy,
  move: FolderInput,
  write: FileInput,
  notify: Bell,
};
const api = window.studio;
function RelayMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" focusable="false">
      <rect x="10" y="10" width="236" height="236" rx="58" fill="#10252e" />
      <path
        d="M62 68h66c23 0 42 19 42 42s-19 42-42 42H62v38"
        fill="none"
        stroke="#49dfbd"
        strokeWidth="17"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M113 152l51 39h29"
        fill="none"
        stroke="#f1f8f5"
        strokeWidth="17"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m177 169 25 22-25 22"
        fill="none"
        stroke="#f1f8f5"
        strokeWidth="17"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="62" cy="68" r="12" fill="#f1f8f5" />
      <circle cx="62" cy="190" r="12" fill="#49dfbd" />
    </svg>
  );
}
function StepNode({ data, selected }: NodeProps<Node<Step['data']>>) {
  const Icon = icons[data.kind];
  const detail =
    data.kind === 'trigger'
      ? data.config.folder
        ? data.config.folder.split(/[\\/]/).pop()
        : 'Choose a folder to watch'
      : data.kind === 'filter'
        ? `${data.config.field} ${data.config.operator} ${data.config.value}`
        : data.kind === 'ai'
          ? data.config.format === 'json'
            ? 'Extract structured fields'
            : 'Generate text with your model'
          : ['move', 'copy', 'write'].includes(data.kind)
            ? data.config.folder
              ? data.config.folder.split(/[\\/]/).pop()
              : 'Choose an output folder'
            : catalog[data.kind].description;
  return (
    <div className={`step-node ${selected ? 'selected' : ''} ${data.state || ''}`}>
      {data.kind !== 'trigger' && <Handle type="target" position={Position.Left} />}
      <div className="node-top">
        <span className={`node-icon ${catalog[data.kind].color}`}>
          <Icon size={17} />
        </span>
        <span className="node-kind">{catalog[data.kind].group}</span>
        {data.state === 'running' ? (
          <LoaderCircle size={14} className="spin" />
        ) : data.state === 'success' ? (
          <CheckCircle2 size={14} className="green-text" />
        ) : (
          <MoreHorizontal size={16} />
        )}
      </div>
      <strong>{data.label || catalog[data.kind].name}</strong>
      <p>{detail}</p>
      {data.kind === 'filter' ? (
        <>
          <span className="branch yes">Yes</span>
          <Handle type="source" position={Position.Right} id="yes" style={{ top: '62%' }} />
          <span className="branch no">No</span>
          <Handle type="source" position={Position.Right} id="no" style={{ top: '85%' }} />
        </>
      ) : (
        <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}
const nodeTypes = { step: StepNode };
function Button({
  children,
  onClick,
  className = '',
  disabled = false,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button title={title} className={`button ${className}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function StateBadge({ status }: { status: string }) {
  return (
    <span className={`state-badge ${status}`}>
      {status === 'running' && <LoaderCircle size={11} className="spin" />}
      {status}
    </span>
  );
}
function shortPath(value: string) {
  return value.split(/[\\/]/).pop() || value;
}
export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [page, setPage] = useState<
    'editor' | 'templates' | 'history' | 'connections' | 'cloud' | 'organizer'
  >('editor');
  const [organizerTemplate, setOrganizerTemplate] = useState<OrganizerTemplate>();
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false),
    [toast, setToast] = useState('');
  const [palette, setPalette] = useState(false),
    [guide, setGuide] = useState(false),
    [runModal, setRunModal] = useState(false);
  const [file, setFile] = useState(''),
    [running, setRunning] = useState(false),
    [runId, setRunId] = useState<string | null>(null);
  const [folderMode, setFolderMode] = useState(false);
  const [batchFolder, setBatchFolder] = useState('');
  const [includeSubfolders, setIncludeSubfolders] = useState(false);
  const [showRun, setShowRun] = useState(false),
    [search, setSearch] = useState('');
  const refresh = useCallback(async () => {
    const state = await api.snapshot();
    setSnapshot(state);
    setWorkflow((w) => w || state.workflows[0] || null);
  }, []);
  useEffect(() => {
    refresh().catch((e) => setToast(e.message));
    return api.onUpdate(() => {
      void refresh();
    });
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);
  async function attempt(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (error) {
      setToast((error as Error).message);
    }
  }
  async function save(): Promise<Workflow> {
    if (!workflow) throw new Error('Select a workflow first.');
    const w = await api.save(workflow);
    setWorkflow(w);
    setDirty(false);
    await refresh();
    return w;
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        if (workflow && !snapshot?.busy)
          void attempt(async () => {
            await save();
            setToast('Workflow saved.');
          });
      }
      if (event.key === 'Escape') {
        setPalette(false);
        setRunModal(false);
        setGuide(false);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  function load(w: Workflow) {
    if (dirty && !confirm('Discard unsaved workflow changes?')) return;
    setWorkflow(structuredClone(w));
    setDirty(false);
    setSelected(null);
    setPage('editor');
    setFile('');
    setRunId(null);
    setShowRun(false);
  }
  function change(fn: (w: Workflow) => Workflow) {
    if (snapshot?.busy) return;
    setWorkflow((w) => (w ? fn(w) : null));
    setDirty(true);
  }
  function config(key: string, value: string) {
    change((w) => ({
      ...w,
      nodes: w.nodes.map((n) =>
        n.id === selected
          ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } }
          : n,
      ),
    }));
  }
  function add(kind: Kind) {
    if (!workflow) return;
    const id = crypto.randomUUID();
    change((w) => ({
      ...w,
      nodes: [
        ...w.nodes,
        {
          id,
          type: 'step',
          position: {
            x: 100 + (w.nodes.length % 3) * 315,
            y: 100 + Math.floor(w.nodes.length / 3) * 230,
          },
          data: { kind, label: catalog[kind].name, config: { ...catalog[kind].defaults } },
        },
      ],
    }));
    setSelected(id);
    setPalette(false);
  }
  function connect(connection: Connection) {
    change((w) => ({ ...w, edges: addEdge(connection, w.edges) }));
  }
  function removeNode() {
    if (!selected) return;
    change((w) => ({
      ...w,
      nodes: w.nodes.filter((n) => n.id !== selected),
      edges: w.edges.filter((e) => e.source !== selected && e.target !== selected),
    }));
    setSelected(null);
  }
  async function run(preview: boolean) {
    if (folderMode ? !batchFolder : !file) return;
    const w = dirty ? await save() : workflow!;
    setRunning(true);
    setRunModal(false);
    setShowRun(true);
    setRunId(null);
    try {
      if (folderMode) {
        const batch = await api.executeFolder(w.id, batchFolder, includeSubfolders, preview);
        setRunId(batch.last?.id || null);
        setToast(
          `${preview ? 'Previewed' : 'Processed'} ${batch.completed} of ${batch.total} files. ${batch.last?.status === 'failed' ? 'Stopped on an error; inspect Run history.' : 'See Run history for each file.'}`,
        );
        return;
      }
      const result = await api.execute(w.id, file, preview);
      setRunId(result.id);
      if (!preview && result.steps.some((s) => s.effect?.type === 'move')) setFile('');
    } finally {
      setRunning(false);
      await refresh();
    }
  }
  async function cloudAuth(input: {
    mode: 'login' | 'register';
    baseUrl: string;
    email: string;
    password: string;
  }) {
    await attempt(async () => {
      const connected = await api.cloudAuth(input);
      await refresh();
      setToast(`Connected to ${connected.workspaceName || 'Relay workspace'}.`);
    });
  }
  async function cloudPush() {
    await attempt(async () => {
      const current = dirty ? await save() : workflow;
      if (!current) throw new Error('Select a workflow first.');
      await api.cloudPush(current.id);
      setToast('Workflow synced to the cloud workspace.');
    });
  }
  async function cloudPull() {
    await attempt(async () => {
      const workflows = await api.cloudPull();
      if (workflows.length) load(workflows[0]);
      await refresh();
      setToast(
        workflows.length
          ? `Pulled ${workflows.length} workflow${workflows.length === 1 ? '' : 's'} from the cloud.`
          : 'The cloud workspace has no workflows yet.',
      );
    });
  }
  async function cloudShare() {
    await attempt(async () => {
      const current = dirty ? await save() : workflow;
      if (!current) throw new Error('Select a workflow first.');
      const url = await api.cloudShare(current.id);
      setToast(`Share link: ${url}`);
    });
  }
  const node = workflow?.nodes.find((n) => n.id === selected);
  const watching = !!workflow && !!snapshot?.watching.includes(workflow.id);
  const relevantRuns = snapshot?.runs.filter((r) => r.workflowId === workflow?.id) || [];
  const currentRun = snapshot?.runs.find((r) => r.id === runId) || relevantRuns[0];
  const busy = running || !!snapshot?.busy;
  if (!snapshot)
    return (
      <div className="loading">
        <span className="brand-mark">
          <RelayMark size={32} />
        </span>
        <h2>Opening your studio</h2>
        {toast || 'Loading local workspace…'}
      </div>
    );
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <RelayMark size={30} />
          </span>
          <div>
            relay<span>STUDIO</span>
          </div>
        </div>
        <div className="workspace-switch">
          <span className="avatar">P</span>
          <div>
            Personal workspace<small>Local workspace</small>
          </div>
          <ChevronDown size={13} />
        </div>
        <div className="nav-label">BUILD & MANAGE</div>
        <button
          className={`nav-item ${page === 'organizer' ? 'active' : ''}`}
          onClick={() => {
            setOrganizerTemplate(undefined);
            setPage('organizer');
          }}
        >
          <Folder size={17} />
          File organizer
        </button>
        <button
          className={`nav-item ${page === 'editor' ? 'active' : ''}`}
          onClick={() => setPage('editor')}
        >
          <WorkflowIcon size={17} />
          Workflows<span className="count">{snapshot.workflows.length}</span>
        </button>
        <button
          className={`nav-item ${page === 'templates' ? 'active' : ''}`}
          onClick={() => setPage('templates')}
        >
          <LayoutGrid size={17} />
          Templates
        </button>
        <button
          className={`nav-item ${page === 'history' ? 'active' : ''}`}
          onClick={() => setPage('history')}
        >
          <Activity size={17} />
          Run history
        </button>
        <button
          className={`nav-item ${page === 'connections' ? 'active' : ''}`}
          onClick={() => setPage('connections')}
        >
          <Sparkles size={17} />
          AI connections
        </button>
        <button
          className={`nav-item ${page === 'cloud' ? 'active' : ''}`}
          onClick={() => setPage('cloud')}
        >
          <Cloud size={17} />
          Cloud workspace
        </button>
        <div className="nav-label flows-heading">
          YOUR WORKFLOWS
          <button
            title="New workflow"
            disabled={busy}
            onClick={() => {
              if (dirty && !confirm('Discard unsaved changes?')) return;
              const w = blankWorkflow();
              setWorkflow(w);
              setDirty(true);
              setSelected(w.nodes[0].id);
              setPage('editor');
              setRunId(null);
              setShowRun(false);
            }}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="workflow-links">
          {snapshot.workflows.map((w) => (
            <button
              key={w.id}
              className={`workflow-link ${workflow?.id === w.id && page === 'editor' ? 'chosen' : ''}`}
              onClick={() => load(w)}
            >
              <span
                className={snapshot.watching.includes(w.id) ? 'status-dot online' : 'status-dot'}
              />
              <span>{w.name}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="local-card">
            <ShieldCheck size={17} />
            <strong>Runs on your machine</strong>
            <p>
              Your files. Your workflows.
              <br />
              Your choice of AI.
            </p>
            <span>
              {snapshot.watching.length
                ? `${snapshot.watching.length} folder watcher active`
                : 'All folder watchers paused'}
            </span>
          </div>
          <button className="nav-item" onClick={() => setGuide(true)}>
            <BookOpen size={16} />
            Quick start guide
            <ArrowRight size={14} />
          </button>
          <div className="version">
            RELAY STUDIO <span>v1.3.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <div className="topbar">
          <div>
            <span>Personal workspace</span>
            <ChevronRight size={13} />
            <strong>
              {page === 'organizer'
                ? 'File organizer'
                : page === 'editor'
                  ? 'Workflows'
                  : page === 'connections'
                    ? 'AI connections'
                    : page === 'cloud'
                      ? 'Cloud workspace'
                      : page === 'history'
                        ? 'Run history'
                        : 'Templates'}
            </strong>
          </div>
          <div className="top-status">
            <span className="status-dot online" />
            Local engine <span className="top-divider" /> <span className="avatar small">Y</span>
          </div>
        </div>
        {page === 'editor' && workflow ? (
          <>
            <header className="editor-header">
              <div className="title-row">
                <div className="workflow-symbol">
                  <WorkflowIcon size={24} />
                </div>
                <div>
                  <input
                    aria-label="Workflow name"
                    className="workflow-title"
                    value={workflow.name}
                    maxLength={100}
                    disabled={busy}
                    onChange={(e) => change((w) => ({ ...w, name: e.target.value }))}
                  />
                  <div className="workflow-subtitle">
                    <span className={`status-dot ${watching ? 'online' : ''}`} />
                    {watching ? 'Watching for new files' : 'Draft · watching paused'}
                    <span>·</span>
                    {dirty ? 'Unsaved changes' : 'Saved on this device'}
                  </div>
                </div>
              </div>
              <div className="header-actions">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void attempt(async () => {
                      await save();
                      setToast('Workflow saved. Watching is paused after edits.');
                    })
                  }
                >
                  <Save size={15} />
                  {dirty ? 'Save changes' : 'Save'}
                </Button>
                <Button
                  disabled={busy || watching}
                  className="primary"
                  onClick={() => setRunModal(true)}
                >
                  <Play size={15} />
                  Test workflow
                </Button>
                <Button
                  disabled={busy || watching}
                  onClick={() => {
                    setFolderMode(true);
                    setRunModal(true);
                  }}
                >
                  <Folder size={15} /> Organize existing folder
                </Button>
              </div>
            </header>
            <div className="editor-tabs">
              <div>
                <button className="tab active">
                  <Layers3 size={14} />
                  Editor
                </button>
                <button
                  className={`tab ${showRun ? 'highlight' : ''}`}
                  onClick={() => setShowRun(!showRun)}
                >
                  <Activity size={14} />
                  Executions<span>{relevantRuns.length}</span>
                </button>
              </div>
              <div className="editor-tools">
                <button
                  onClick={() =>
                    void attempt(async () => {
                      if (dirty) await save();
                      if (await api.exportWorkflow(workflow.id))
                        setToast('Workflow exported without folder paths or credentials.');
                    })
                  }
                  disabled={busy}
                >
                  <Upload size={14} />
                  Export
                </button>
                <button
                  disabled={busy}
                  className={watching ? 'watch-active' : ''}
                  onClick={() =>
                    void attempt(async () => {
                      if (dirty) await save();
                      await api.watch(workflow.id, !watching);
                      setRunId(null);
                      await refresh();
                      setToast(
                        watching
                          ? 'Folder watching paused.'
                          : 'Watching new files while Relay Studio is open.',
                      );
                    })
                  }
                >
                  {watching ? <Pause size={14} /> : <Radio size={14} />}{' '}
                  {watching ? 'Pause watcher' : 'Enable watching'}
                </button>
              </div>
            </div>
            <div className="editor-body">
              <div className="canvas-column">
                <div className="canvas">
                  <div className="canvas-toolbar">
                    <span>
                      <span className="status-dot online" />
                      WORKFLOW CANVAS
                    </span>
                    <Button disabled={busy} onClick={() => setPalette(true)}>
                      <Plus size={14} />
                      Add step
                    </Button>
                  </div>
                  <ReactFlow
                    key={workflow.id}
                    nodes={workflow.nodes.map((n) => ({
                      ...n,
                      data: {
                        ...n.data,
                        state: showRun
                          ? currentRun?.steps.find((s) => s.nodeId === n.id)?.status
                          : undefined,
                      },
                      selected: n.id === selected,
                    }))}
                    edges={workflow.edges.map((e) => ({
                      ...e,
                      type: 'smoothstep',
                      animated: busy,
                      style: { stroke: '#59616e', strokeWidth: 1.5 },
                      label:
                        e.sourceHandle === 'yes'
                          ? 'Yes'
                          : e.sourceHandle === 'no'
                            ? 'No'
                            : undefined,
                    }))}
                    nodeTypes={nodeTypes}
                    onNodeClick={(_, n) => setSelected(n.id)}
                    onPaneClick={() => setSelected(null)}
                    onNodesChange={(changes: NodeChange<Step>[]) => {
                      if (changes.every((c) => c.type === 'select')) return;
                      if (changes.every((c) => c.type === 'dimensions' || c.type === 'select')) {
                        setWorkflow((w) =>
                          w ? { ...w, nodes: applyNodeChanges(changes, w.nodes) } : null,
                        );
                        return;
                      }
                      change((w) => ({ ...w, nodes: applyNodeChanges(changes, w.nodes) }));
                    }}
                    onEdgesChange={(changes: EdgeChange[]) => {
                      if (changes.every((c) => c.type === 'select')) return;
                      change((w) => ({ ...w, edges: applyEdgeChanges(changes, w.edges) }));
                    }}
                    onConnect={connect}
                    nodesDraggable={!busy}
                    nodesConnectable={!busy}
                    edgesReconnectable={false}
                    deleteKeyCode={null}
                    fitView
                    fitViewOptions={{ padding: 0.22, maxZoom: 0.9 }}
                    minZoom={0.25}
                    maxZoom={1.5}
                    proOptions={{ hideAttribution: true }}
                    colorMode="dark"
                  >
                    <Background color="#30353d" gap={22} size={1} />
                    <Controls showInteractive={false} />
                    <MiniMap pannable zoomable nodeColor="#777095" maskColor="#111418c9" />
                  </ReactFlow>
                  <div className="canvas-hint">
                    <MousePointer2 size={13} />
                    Click a step to configure · Drag between handles to connect
                  </div>
                </div>
                {showRun && (
                  <RunInspector
                    run={currentRun}
                    busy={busy}
                    onClose={() => setShowRun(false)}
                    onCancel={() => void attempt(() => api.cancel())}
                    onUndo={() =>
                      currentRun &&
                      void attempt(async () => {
                        await api.undo(currentRun.id);
                        await refresh();
                      })
                    }
                  />
                )}
              </div>
              <aside className="inspector">
                {node ? (
                  <>
                    <div className="inspector-heading">
                      <span>STEP CONFIGURATION</span>
                      <button title="Close inspector" onClick={() => setSelected(null)}>
                        <X size={16} />
                      </button>
                    </div>
                    <div className="inspector-title">
                      <span className={`node-icon ${catalog[node.data.kind].color}`}>
                        {(() => {
                          const Icon = icons[node.data.kind];
                          return <Icon size={21} />;
                        })()}
                      </span>
                      <h2>{catalog[node.data.kind].name}</h2>
                    </div>
                    <p className="muted">{catalog[node.data.kind].description}</p>
                    <fieldset disabled={busy}>
                      <Field label="Step name">
                        <input
                          value={node.data.label}
                          maxLength={100}
                          onChange={(e) =>
                            change((w) => ({
                              ...w,
                              nodes: w.nodes.map((n) =>
                                n.id === selected
                                  ? { ...n, data: { ...n.data, label: e.target.value } }
                                  : n,
                              ),
                            }))
                          }
                        />
                      </Field>
                      {['trigger', 'copy', 'move', 'write'].includes(node.data.kind) && (
                        <Field
                          label={
                            node.data.kind === 'trigger' ? 'Watch folder' : 'Destination folder'
                          }
                          hint={
                            node.data.kind === 'trigger'
                              ? 'Only new files directly inside this folder. Existing files are ignored.'
                              : 'Choose an existing folder. Existing files will never be overwritten.'
                          }
                        >
                          <div className="folder-picker">
                            <input
                              readOnly
                              value={node.data.config.folder}
                              placeholder="No folder selected"
                            />
                            <button
                              title="Browse folder"
                              onClick={() =>
                                void attempt(async () => {
                                  const folder = await api.chooseFolder();
                                  if (folder) config('folder', folder);
                                })
                              }
                            >
                              <Folder size={16} />
                            </button>
                          </div>
                        </Field>
                      )}
                      {node.data.kind === 'filter' && (
                        <>
                          <Field label="Check this value">
                            <select
                              value={node.data.config.field}
                              onChange={(e) => config('field', e.target.value)}
                            >
                              <option value="extension">File extension</option>
                              <option value="name">File name</option>
                              <option value="text">Extracted text</option>
                              <option value="ai">AI output</option>
                            </select>
                          </Field>
                          <Field label="Condition">
                            <select
                              value={node.data.config.operator}
                              onChange={(e) => config('operator', e.target.value)}
                            >
                              <option value="equals">Equals (case insensitive)</option>
                              <option value="contains">Contains (case insensitive)</option>
                            </select>
                          </Field>
                          <Field label="Compare with">
                            <input
                              value={node.data.config.value}
                              onChange={(e) => config('value', e.target.value)}
                            />
                          </Field>
                          <div className="info-box">
                            <GitBranch size={16} />
                            <p>
                              Connect the <strong>Yes</strong> and <strong>No</strong> handles to
                              different steps. An unconnected branch ends the run.
                            </p>
                          </div>
                        </>
                      )}
                      {node.data.kind === 'ai' && (
                        <>
                          <div className="connection-chip">
                            <Sparkles size={14} />
                            {snapshot.settings.model || 'No AI model connected'}
                            <button onClick={() => setPage('connections')}>
                              Set up <ArrowRight size={12} />
                            </button>
                          </div>
                          <Field label="Instructions">
                            <textarea
                              rows={6}
                              value={node.data.config.prompt}
                              onChange={(e) => config('prompt', e.target.value)}
                            />
                          </Field>
                          <Field label="Output format">
                            <select
                              value={node.data.config.format}
                              onChange={(e) => config('format', e.target.value)}
                            >
                              <option value="text">Plain text / Markdown</option>
                              <option value="json">Structured fields (JSON)</option>
                            </select>
                          </Field>
                          {node.data.config.format === 'json' && (
                            <Field
                              label="Required fields"
                              hint="Comma-separated names. Use {{ai.company}} in later steps."
                            >
                              <input
                                value={node.data.config.fields}
                                onChange={(e) => config('fields', e.target.value)}
                              />
                            </Field>
                          )}
                          <div className="info-box">
                            <ShieldCheck size={16} />
                            <p>
                              {snapshot.settings.provider === 'ollama'
                                ? 'Processed by your local model. AI requests are skipped during preview.'
                                : 'Document text is sent to your configured cloud provider during real runs.'}
                            </p>
                          </div>
                        </>
                      )}
                      {['rename', 'write'].includes(node.data.kind) && (
                        <Field label="File name pattern">
                          <input
                            value={node.data.config.name}
                            onChange={(e) => config('name', e.target.value)}
                          />
                        </Field>
                      )}
                      {node.data.kind === 'write' && (
                        <Field label="File contents">
                          <textarea
                            rows={5}
                            value={node.data.config.content}
                            onChange={(e) => config('content', e.target.value)}
                          />
                        </Field>
                      )}
                      {node.data.kind === 'notify' && (
                        <Field label="Notification message">
                          <textarea
                            rows={3}
                            value={node.data.config.message}
                            onChange={(e) => config('message', e.target.value)}
                          />
                        </Field>
                      )}
                      {node.data.kind === 'read' && (
                        <div className="info-box">
                          <FileText size={16} />
                          <p>
                            Reads text-based PDFs and common text formats. Maximum 25 MB. Scanned
                            PDFs need OCR and are not supported.
                          </p>
                        </div>
                      )}
                      {['write', 'rename', 'notify'].includes(node.data.kind) && (
                        <div className="variables">
                          <span>AVAILABLE VARIABLES</span>
                          {['name', 'stem', 'ext', 'date', 'text', 'ai'].map((v) => (
                            <code key={v}>{`{{${v}}}`}</code>
                          ))}
                          <p>
                            Use fields from structured AI output as {'{{ai.field}}'}. The engine
                            stops if a field is missing.
                          </p>
                        </div>
                      )}
                    </fieldset>
                    {node.data.kind !== 'trigger' && (
                      <Button className="danger full" disabled={busy} onClick={removeNode}>
                        <Trash2 size={14} />
                        Remove step
                      </Button>
                    )}
                    <div className="connections-list">
                      <span>OUTGOING CONNECTIONS</span>
                      {workflow.edges
                        .filter((e) => e.source === node.id)
                        .map((e) => (
                          <div key={e.id}>
                            <span>
                              {e.sourceHandle ? `${e.sourceHandle} → ` : '→ '}
                              {workflow.nodes.find((n) => n.id === e.target)?.data.label}
                            </span>
                            <button
                              title="Remove connection"
                              disabled={busy}
                              onClick={() =>
                                change((w) => ({
                                  ...w,
                                  edges: w.edges.filter((link) => link.id !== e.id),
                                }))
                              }
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="inspector-heading">
                      WORKFLOW OVERVIEW
                      <Settings2 size={15} />
                    </div>
                    <div className="overview-icon">
                      <WorkflowIcon size={27} />
                    </div>
                    <h2>
                      A little flow.
                      <br />A lot off your plate.
                    </h2>
                    <p className="muted">{workflow.description}</p>
                    <div className="overview-stats">
                      <div>
                        <strong>{workflow.nodes.length}</strong>
                        <span>steps</span>
                      </div>
                      <div>
                        <strong>{workflow.nodes.filter((n) => n.data.kind === 'ai').length}</strong>
                        <span>AI actions</span>
                      </div>
                      <div>
                        <strong>{relevantRuns.length}</strong>
                        <span>recent runs</span>
                      </div>
                    </div>
                    <div className="setup-list">
                      <h3>Make it yours</h3>
                      <div>
                        <span>1</span>
                        <p>Select the trigger and choose a folder.</p>
                      </div>
                      <div>
                        <span>2</span>
                        <p>Configure each action and connect your steps.</p>
                      </div>
                      <div>
                        <span>3</span>
                        <p>Preview a sample file, then run or enable watching.</p>
                      </div>
                    </div>
                    <div className="info-box">
                      <ShieldCheck size={16} />
                      <p>
                        Preview reads your sample file but makes no file changes or AI requests.
                      </p>
                    </div>
                    <Button className="full" onClick={() => setGuide(true)}>
                      <BookOpen size={14} />
                      How workflows work
                    </Button>
                    <Button
                      className="danger full subtle"
                      disabled={busy}
                      onClick={() =>
                        void attempt(async () => {
                          if (await api.remove(workflow.id)) {
                            setWorkflow(null);
                            setDirty(false);
                            await refresh();
                          }
                        })
                      }
                    >
                      <Trash2 size={14} />
                      Delete workflow
                    </Button>
                  </>
                )}
              </aside>
            </div>
            <div className="statusbar">
              <span>
                <span className="status-dot online" />
                {busy ? 'Engine running' : 'Engine ready'}
                <span className="status-divider" />
                SQLite workspace
              </span>
              <span>
                {workflow.nodes.length} steps · {workflow.edges.length} connections
                <span className="status-divider" />
                Changes saved explicitly
              </span>
            </div>
          </>
        ) : page === 'editor' ? (
          <div className="empty-page">
            <WorkflowIcon size={40} />
            <h1>Your next routine, automated.</h1>
            <Button className="primary" onClick={() => setPage('templates')}>
              Choose a template
            </Button>
          </div>
        ) : null}
        {page === 'organizer' && <Organizer initialTemplate={organizerTemplate} busy={busy} />}
        {page === 'templates' && (
          <div className="page-content">
            <div className="page-eyebrow">READY TO USE</div>
            <h1>Pick a job for Relay.</h1>
            <p className="page-description">
              File tools work locally. AI templates use the model you connect.
            </p>
            {[false, true].map((ai) => (
              <section key={String(ai)}>
                <h2>{ai ? 'AI powered' : 'No AI needed'}</h2>
                <p className="page-description">
                  {ai
                    ? 'Connect a local model or your own cloud provider in AI connections.'
                    : 'No model, API key, account, or server required.'}
                </p>
                {
                  <OrganizerCards
                    ai={ai}
                    choose={(id) => {
                      setOrganizerTemplate(id);
                      setPage('organizer');
                    }}
                  />
                }
                <div className={`template-grid ${ai ? 'ai-template-grid' : 'local-template-grid'}`}>
                  {templates()
                    .filter((t) => t.nodes.some((n) => n.data.kind === 'ai') === ai)
                    .map((t, i) => (
                      <article className="template-card" key={t.id}>
                        <div className={`template-art art-${i}`}>
                          <span className="template-mini">
                            <FolderInput />
                          </span>
                          <span className="dash-line" />
                          <span className="template-mini accent">
                            {!ai ? <Folder /> : <Sparkles />}
                          </span>
                          <span className="dash-line" />
                          <span className="template-mini">
                            <Check />
                          </span>
                        </div>
                        <div className="template-content">
                          <span className="pill">{!ai ? 'NO AI REQUIRED' : 'AI POWERED'}</span>
                          <h2>{t.name}</h2>
                          <p>{t.description}</p>
                          <div>
                            <span>{t.nodes.length} connected steps</span>
                            <Button
                              disabled={busy}
                              onClick={() =>
                                void attempt(async () => {
                                  if (dirty && !confirm('Discard unsaved changes?')) return;
                                  const copy = {
                                    ...t,
                                    id: crypto.randomUUID(),
                                    name: t.name + ' copy',
                                  };
                                  const saved = await api.save(copy);
                                  setDirty(false);
                                  setWorkflow(saved);
                                  setPage('editor');
                                  setSelected(saved.nodes[0].id);
                                  setFile('');
                                  setShowRun(false);
                                  await refresh();
                                })
                              }
                            >
                              Use template
                              <ArrowRight size={14} />
                            </Button>
                          </div>
                        </div>
                      </article>
                    ))}
                </div>
              </section>
            ))}
            <div className="import-card">
              <div>
                <Upload size={23} />
                <div>
                  <h3>Bring your own workflow</h3>
                  <p>Import a Relay JSON recipe. Choose local folders before running it.</p>
                </div>
              </div>
              <Button
                disabled={busy}
                onClick={() =>
                  void attempt(async () => {
                    if (dirty && !confirm('Discard unsaved changes?')) return;
                    const w = await api.importWorkflow();
                    if (w) {
                      setDirty(false);
                      setWorkflow(w);
                      setPage('editor');
                      setSelected(null);
                      setShowRun(false);
                      setFile('');
                      await refresh();
                    }
                  })
                }
              >
                Import workflow
              </Button>
            </div>
          </div>
        )}
        {page === 'history' && (
          <div className="page-content">
            <div className="page-eyebrow">NOTHING HAPPENS IN A BLACK BOX</div>
            <h1>Every run, accounted for.</h1>
            <p className="page-description">
              Inspect inputs, results, and file changes. Your latest 100 runs are shown.
            </p>
            <div className="history-toolbar">
              <div className="search">
                <Search size={15} />
                <input
                  placeholder="Search workflow or file…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <span>{snapshot.runs.length} recent runs</span>
            </div>
            <div className="history-table">
              <div className="history-row heading">
                <span>WORKFLOW / FILE</span>
                <span>MODE</span>
                <span>STARTED</span>
                <span>RESULT</span>
              </div>
              {snapshot.runs
                .filter((r) =>
                  (r.workflowName + r.source).toLowerCase().includes(search.toLowerCase()),
                )
                .map((r) => (
                  <button
                    key={r.id}
                    className={`history-row ${runId === r.id ? 'chosen' : ''}`}
                    onClick={() => setRunId(r.id)}
                  >
                    <span>
                      <strong>{r.workflowName}</strong>
                      <small>{shortPath(r.source)}</small>
                    </span>
                    <span>
                      {r.preview
                        ? 'Preview'
                        : r.origin === 'watch'
                          ? 'Folder watcher'
                          : 'Manual run'}
                    </span>
                    <span>{new Date(r.startedAt).toLocaleString()}</span>
                    <StateBadge status={r.undone ? 'undone' : r.status} />
                  </button>
                ))}
              {!snapshot.runs.length && (
                <div className="empty-history">
                  <Clock3 size={30} />
                  <h3>Your first run starts a story.</h3>
                  <p>Open a workflow and choose Test workflow to see its execution here.</p>
                </div>
              )}
            </div>
            {snapshot.runs.find((r) => r.id === runId) && (
              <RunInspector
                run={snapshot.runs.find((r) => r.id === runId)}
                busy={busy}
                onClose={() => setRunId(null)}
                onCancel={() => void attempt(() => api.cancel())}
                onUndo={() =>
                  void attempt(async () => {
                    await api.undo(runId!);
                    await refresh();
                  })
                }
              />
            )}
          </div>
        )}
        {page === 'connections' && (
          <Connections
            settings={snapshot.settings}
            busy={busy}
            onSave={async (s) => {
              try {
                await api.settings(s);
                await refresh();
                setToast('AI connection saved.');
                return true;
              } catch (error) {
                setToast((error as Error).message);
                return false;
              }
            }}
            onTest={() =>
              attempt(async () => {
                const response = await api.testAI();
                setToast(`Connection successful: ${response.slice(0, 100)}`);
              })
            }
          />
        )}
        {page === 'cloud' && (
          <CloudWorkspace
            cloud={snapshot.cloud}
            busy={busy}
            onAuth={cloudAuth}
            onDisconnect={() =>
              attempt(async () => {
                await api.cloudDisconnect();
                await refresh();
                setToast('Disconnected from the cloud workspace.');
              })
            }
            onPush={cloudPush}
            onPull={cloudPull}
            onShare={cloudShare}
          />
        )}
      </div>
      {palette && (
        <div className="modal-backdrop" onClick={() => setPalette(false)}>
          <div className="modal palette-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <span className="page-eyebrow">BUILDING BLOCKS</span>
                <h2>What happens next?</h2>
              </div>
              <button onClick={() => setPalette(false)} aria-label="Close">
                <X size={19} />
              </button>
            </div>
            <div className="palette-grid">
              {(Object.keys(catalog) as Kind[])
                .filter((k) => k !== 'trigger')
                .map((kind) => {
                  const Icon = icons[kind];
                  return (
                    <button key={kind} onClick={() => add(kind)}>
                      <span className={`node-icon ${catalog[kind].color}`}>
                        <Icon size={19} />
                      </span>
                      <div>
                        <strong>{catalog[kind].name}</strong>
                        <p>{catalog[kind].description}</p>
                      </div>
                      <Plus size={15} />
                    </button>
                  );
                })}
            </div>
            <p className="hint">
              After adding a step, drag a connection from the previous step’s output handle.
            </p>
          </div>
        </div>
      )}
      {runModal && (
        <div className="modal-backdrop">
          <div className="modal run-modal">
            <div className="modal-heading">
              <div>
                <span className="page-eyebrow">TRY IT ON ONE FILE</span>
                <h2>
                  {folderMode
                    ? 'Process files already in a folder.'
                    : 'See your workflow in action.'}
                </h2>
              </div>
              <button onClick={() => setRunModal(false)} aria-label="Close">
                <X size={19} />
              </button>
            </div>
            <p className="muted">
              {folderMode
                ? 'Apply this workflow to existing files, one at a time. Output folders are excluded. Stops at the first error; each file appears in Run history.'
                : 'Choose a sample file. Start with a preview to inspect the plan, then run when you’re ready.'}
            </p>
            <div className="connection-actions">
              <Button onClick={() => setFolderMode(false)} disabled={busy}>
                One file
              </Button>
              <Button onClick={() => setFolderMode(true)} disabled={busy}>
                Existing folder
              </Button>
            </div>
            <button
              className="sample-picker"
              onClick={() =>
                void attempt(async () => {
                  const chosen = folderMode ? await api.chooseFolder() : await api.chooseFile();
                  if (chosen) {
                    if (folderMode) setBatchFolder(chosen);
                    else setFile(chosen);
                  }
                })
              }
            >
              <FileText size={27} />
              <strong>
                {folderMode
                  ? batchFolder
                    ? shortPath(batchFolder)
                    : 'Choose an existing folder'
                  : file
                    ? shortPath(file)
                    : 'Choose a sample file'}
              </strong>
              <span>
                {folderMode
                  ? batchFolder || 'Files are processed using the current workflow'
                  : file || 'Text files, documents, and more'}
              </span>
            </button>
            {folderMode && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={includeSubfolders}
                  onChange={(e) => setIncludeSubfolders(e.target.checked)}
                />
                <span>Include files inside subfolders. Folder containers are left in place.</span>
              </label>
            )}
            <div className="run-options">
              <div>
                <ShieldCheck size={20} />
                <h3>Preview first</h3>
                <p>
                  Read the file and inspect the plan. No file changes, notifications, or AI
                  requests.
                </p>
                <Button
                  disabled={!(folderMode ? batchFolder : file) || busy}
                  onClick={() => void attempt(() => run(true))}
                >
                  <Play size={14} />
                  Preview workflow
                </Button>
              </div>
              <div>
                <Zap size={20} />
                <h3>Run for real</h3>
                <p>
                  Execute file actions. AI steps use your configured connection
                  {snapshot.settings.provider === 'cloud'
                    ? ' and send document text to the cloud'
                    : ''}
                  .
                </p>
                <Button
                  className="primary"
                  disabled={!(folderMode ? batchFolder : file) || busy}
                  onClick={() => void attempt(() => run(false))}
                >
                  <Play size={14} />
                  Run workflow
                </Button>
              </div>
            </div>
            <p className="hint">
              Unsaved workflow changes are saved before testing. Existing destination files are
              never overwritten.
            </p>
          </div>
        </div>
      )}
      {guide && (
        <div className="modal-backdrop">
          <div className="modal guide-modal">
            <div className="modal-heading">
              <div>
                <span className="page-eyebrow">YOUR FIRST AUTOMATION</span>
                <h2>Connect the dots. Get time back.</h2>
              </div>
              <button onClick={() => setGuide(false)} aria-label="Close">
                <X size={19} />
              </button>
            </div>
            <div className="guide-flow">
              <span>
                <FolderInput />
                Trigger
              </span>
              <ArrowRight />
              <span>
                <GitBranch />
                Condition
              </span>
              <ArrowRight />
              <span>
                <Zap />
                Action
              </span>
            </div>
            <p>
              A <strong>trigger</strong> notices a new file. A <strong>condition</strong> chooses a
              path. An <strong>action</strong> does the work. Connect their handles to decide the
              order.
            </p>
            <ol>
              <li>
                Start with <strong>Download organizer</strong> for an automation that needs no AI.
              </li>
              <li>Click each folder step and choose your source and destination folders.</li>
              <li>
                Choose <strong>Test workflow</strong>, pick a sample PDF, and preview the changes.
              </li>
              <li>
                Run it for real, then inspect each step’s result under <strong>Executions</strong>.
              </li>
              <li>
                Enable watching to handle new files while the app stays open. Watchers start paused
                after every restart.
              </li>
            </ol>
            <div className="info-box">
              <ShieldCheck size={18} />
              <p>
                Undo reverses supported file changes only when files are unchanged. Notifications
                and AI requests cannot be reversed. Run history may contain extracted document text.
              </p>
            </div>
            <Button
              className="primary full"
              onClick={() => {
                setGuide(false);
                setPage('templates');
              }}
            >
              Explore the templates
              <ArrowRight size={15} />
            </Button>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function RunInspector({
  run,
  busy,
  onClose,
  onCancel,
  onUndo,
}: {
  run?: Run;
  busy: boolean;
  onClose: () => void;
  onCancel: () => void;
  onUndo: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="run-inspector">
      <div className="run-heading">
        <div>
          <Activity size={15} />
          <strong>{run?.preview ? 'Preview results' : 'Execution details'}</strong>
          {run && <StateBadge status={run.undone ? 'undone' : run.status} />}
        </div>
        <div>
          {busy && (
            <Button onClick={onCancel}>
              <Square size={12} />
              Cancel run
            </Button>
          )}
          {run && !run.preview && !run.undone && run.steps.some((s) => s.effect) && (
            <Button disabled={busy} onClick={onUndo}>
              <Undo2 size={13} />
              Undo files
            </Button>
          )}
          <button aria-label="Close execution details" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>
      {!run ? (
        <div className="run-empty">
          No executions yet. Test a workflow with a sample file to inspect each step.
        </div>
      ) : (
        <>
          <div className="run-summary">
            <span>{shortPath(run.source)}</span>
            <span>
              {run.steps.length} steps visited ·{' '}
              {run.origin === 'watch' ? 'Folder watcher' : 'Manual test'}
            </span>
          </div>
          {run.error && <div className="run-error">{run.error}</div>}
          <div className="run-steps">
            {run.steps.map((s, i) => (
              <div className="run-step" key={s.nodeId}>
                <button onClick={() => setOpen(open === s.nodeId ? null : s.nodeId)}>
                  <span className={`result-icon ${s.status}`}>
                    {s.status === 'running' ? (
                      <LoaderCircle size={13} className="spin" />
                    ) : s.status === 'failed' ? (
                      <X size={13} />
                    ) : (
                      <Check size={13} />
                    )}
                  </span>
                  <span className="step-number">{String(i + 1).padStart(2, '0')}</span>
                  <strong>{s.label}</strong>
                  <span>{s.status}</span>
                  <small>{s.duration} ms</small>
                  <ChevronDown size={13} />
                </button>
                {open === s.nodeId && (
                  <div className="step-output">
                    <label>INPUT FILE</label>
                    <pre>{s.input}</pre>
                    <label>OUTPUT {s.effect?.undone ? '· FILE CHANGE UNDONE' : ''}</label>
                    <pre>{s.output}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
function Connections({
  settings,
  busy,
  onSave,
  onTest,
}: {
  settings: AISettings;
  busy: boolean;
  onSave: (s: AISettings & { apiKey?: string }) => Promise<boolean>;
  onTest: () => Promise<void>;
}) {
  const [form, setForm] = useState(settings),
    [key, setKey] = useState(''),
    [changed, setChanged] = useState(false),
    [testing, setTesting] = useState(false);
  const edit = (patch: Partial<AISettings>) => {
    setForm((s) => ({ ...s, ...patch }));
    setChanged(true);
  };
  return (
    <div className="page-content connections-page">
      <div className="page-eyebrow">INTELLIGENCE, ON YOUR TERMS</div>
      <h1>Give your workflows an AI connection.</h1>
      <p className="page-description">
        AI is optional. File actions and conditions work without a model or an account.
      </p>
      <div className="provider-cards">
        <button
          className={form.provider === 'ollama' ? 'selected' : ''}
          onClick={() =>
            edit({
              provider: 'ollama',
              endpoint: 'http://127.0.0.1:11434',
              model: '',
              allowCloud: false,
            })
          }
        >
          <span className="node-icon green">
            <ShieldCheck />
          </span>
          <div>
            <strong>Local with Ollama</strong>
            <p>Runs on your computer. No per-request API bill.</p>
          </div>
          <Circle size={16} />
        </button>
        <button
          className={form.provider === 'cloud' ? 'selected' : ''}
          onClick={() =>
            edit({
              provider: 'cloud',
              endpoint: 'https://api.openai.com/v1',
              model: '',
              allowCloud: false,
            })
          }
        >
          <span className="node-icon purple">
            <Sparkles />
          </span>
          <div>
            <strong>Bring your own API key</strong>
            <p>Connect an OpenAI-compatible cloud provider.</p>
          </div>
          <Circle size={16} />
        </button>
      </div>
      <div className="connection-form">
        <div className="section-heading">
          <h2>{form.provider === 'ollama' ? 'Local model settings' : 'Cloud provider settings'}</h2>
          <span className="pill">{settings.model ? 'CONFIGURED' : 'NOT CONNECTED'}</span>
        </div>
        <p className="muted">
          {form.provider === 'ollama'
            ? 'Install Ollama separately, download a model, and keep its local service running. Enter the exact installed model name below.'
            : 'Enter your provider’s HTTPS base URL and model name. API billing is separate from chat subscriptions. Your key is encrypted with the operating system credential store.'}
        </p>
        <Field label="Base URL">
          <input value={form.endpoint} onChange={(e) => edit({ endpoint: e.target.value })} />
        </Field>
        <Field
          label="Model name"
          hint={
            form.provider === 'ollama'
              ? 'Use a model you have already downloaded in Ollama.'
              : 'Use a model available to your API account that supports Chat Completions.'
          }
        >
          <input
            placeholder="Enter exact model name"
            value={form.model}
            onChange={(e) => edit({ model: e.target.value })}
          />
        </Field>
        {form.provider === 'cloud' && (
          <>
            <Field
              label="API key"
              hint={
                settings.hasKey
                  ? 'A key is saved. Leave blank to keep it unless you change the endpoint.'
                  : 'The key never appears in workflow exports or run logs.'
              }
            >
              <input
                type="password"
                autoComplete="off"
                value={key}
                placeholder={settings.hasKey ? '••••••••••••••••' : 'Paste your API key'}
                onChange={(e) => {
                  setKey(e.target.value);
                  setChanged(true);
                }}
              />
            </Field>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.allowCloud}
                onChange={(e) => edit({ allowCloud: e.target.checked })}
              />
              <span>
                Allow AI steps to send document text to this cloud provider, including during
                watched runs.
              </span>
            </label>
          </>
        )}
        <div className="connection-actions">
          <Button
            disabled={busy || testing}
            className="primary"
            onClick={async () => {
              if (await onSave({ ...form, ...(key ? { apiKey: key } : {}) })) {
                setKey('');
                setChanged(false);
              }
            }}
          >
            <Save size={14} />
            Save connection
          </Button>
          <Button
            disabled={busy || testing || changed || !settings.model}
            onClick={async () => {
              setTesting(true);
              try {
                await onTest();
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? <LoaderCircle className="spin" size={14} /> : <Zap size={14} />}Test
            connection
          </Button>
          {settings.hasKey && (
            <Button
              className="danger"
              disabled={busy}
              onClick={() => onSave({ ...form, apiKey: '' })}
            >
              Remove saved key
            </Button>
          )}
        </div>
      </div>
      <div className="privacy-note">
        <ShieldCheck size={21} />
        <div>
          <h3>Predictable by design</h3>
          <p>
            Preview never calls AI. Real AI steps receive extracted text and your instructions. The
            model cannot execute commands; only your connected action blocks can change files.
          </p>
        </div>
      </div>
    </div>
  );
}
function CloudWorkspace({
  cloud,
  busy,
  onAuth,
  onDisconnect,
  onPush,
  onPull,
  onShare,
}: {
  cloud: CloudSettings;
  busy: boolean;
  onAuth: (input: {
    mode: 'login' | 'register';
    baseUrl: string;
    email: string;
    password: string;
  }) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onPush: () => Promise<void>;
  onPull: () => Promise<void>;
  onShare: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [baseUrl, setBaseUrl] = useState(cloud.baseUrl || 'http://127.0.0.1:4317');
  const [email, setEmail] = useState(cloud.email || '');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  useEffect(() => {
    setBaseUrl(cloud.baseUrl || 'http://127.0.0.1:4317');
    setEmail(cloud.email || '');
  }, [cloud.baseUrl, cloud.email]);
  async function submit() {
    setWorking(true);
    try {
      await onAuth({ mode, baseUrl, email, password });
      setPassword('');
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="page-content cloud-page">
      <div className="page-eyebrow">SYNC, SHARE, AND RUN HISTORY</div>
      <h1>Choose where your workspace lives.</h1>
      <p className="page-description">
        Workflows still run on this computer. This connection only adds accounts, syncing, sharing,
        and cloud run history.
      </p>
      {!cloud.connected ? (
        <div className="cloud-card">
          <div className="section-heading">
            <div>
              <h2>Connect a Relay workspace</h2>
              <p className="muted">
                Use Relay Cloud, your own hosted API, or a Relay API running on this machine.
              </p>
            </div>
            <span className="pill">NOT CONNECTED</span>
          </div>
          <Field
            label="Relay API URL"
            hint="Example: https://relay.example.com or http://127.0.0.1:4317"
          >
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </Field>
          <div className="cloud-fields">
            <Field label="Email">
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          </div>
          <div className="cloud-actions">
            <Button
              className="primary"
              disabled={busy || working || !email || !password}
              onClick={() => void submit()}
            >
              {working ? <LoaderCircle className="spin" size={14} /> : <Cloud size={14} />}
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
            <Button
              disabled={busy || working}
              onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            >
              {mode === 'login' ? 'Need an account?' : 'Already have an account?'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="cloud-card cloud-connected">
          <div className="section-heading">
            <div>
              <h2>{cloud.workspaceName || 'Relay workspace'}</h2>
              <p className="muted">
                {cloud.email} · {cloud.baseUrl}
              </p>
            </div>
            <span className="pill connected-pill">CONNECTED</span>
          </div>
          <div className="cloud-feature-grid">
            <div>
              <Cloud size={18} />
              <strong>Sync workflows</strong>
              <p>Push this workflow or pull the workspace onto another desktop.</p>
            </div>
            <div>
              <WorkflowIcon size={18} />
              <strong>Share workflows</strong>
              <p>Create a read-only link for a teammate or reviewer.</p>
            </div>
            <div>
              <Activity size={18} />
              <strong>Run history</strong>
              <p>Completed local runs are recorded in this workspace.</p>
            </div>
          </div>
          <div className="cloud-actions">
            <Button className="primary" disabled={busy || working} onClick={() => void onPush()}>
              <Upload size={14} />
              Sync current workflow
            </Button>
            <Button disabled={busy || working} onClick={() => void onPull()}>
              <ArrowDownToLine size={14} />
              Pull workflows
            </Button>
            <Button disabled={busy || working} onClick={() => void onShare()}>
              <Copy size={14} />
              Create share link
            </Button>
            <Button
              className="danger"
              disabled={busy || working}
              onClick={() => void onDisconnect()}
            >
              Disconnect
            </Button>
          </div>
        </div>
      )}
      <div className="privacy-note">
        <ShieldCheck size={21} />
        <div>
          <h3>Local first</h3>
          <p>
            File access and workflow runs stay local. Only account data, workflow definitions, and
            run summaries are sent to the API you choose.
          </p>
        </div>
      </div>
    </div>
  );
}
