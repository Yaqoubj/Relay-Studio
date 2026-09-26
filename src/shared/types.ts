export type Kind =
  'trigger' | 'filter' | 'read' | 'ai' | 'rename' | 'copy' | 'move' | 'write' | 'notify';
export type Config = Record<string, string>;
export type Step = {
  id: string;
  type: 'step';
  position: { x: number; y: number };
  data: { kind: Kind; label: string; config: Config; state?: string };
};
export type Link = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};
export type Workflow = {
  id: string;
  name: string;
  description: string;
  nodes: Step[];
  edges: Link[];
  updatedAt: string;
};
export type Effect = {
  type: 'create' | 'move';
  path: string;
  original?: string;
  hash: string;
  undone?: boolean;
};
export type StepResult = {
  nodeId: string;
  label: string;
  kind: Kind;
  status: 'running' | 'success' | 'failed' | 'preview' | 'skipped';
  startedAt: string;
  duration: number;
  input: string;
  output: string;
  effect?: Effect;
};
export type Run = {
  id: string;
  workflowId: string;
  workflowName: string;
  workflow: Workflow;
  source: string;
  preview: boolean;
  origin: 'manual' | 'watch';
  status: 'running' | 'success' | 'failed' | 'cancelled' | 'interrupted';
  startedAt: string;
  finishedAt?: string;
  steps: StepResult[];
  error?: string;
  undone?: boolean;
};
export type AISettings = {
  provider: 'ollama' | 'cloud';
  endpoint: string;
  model: string;
  hasKey: boolean;
  allowCloud: boolean;
};
export type Snapshot = {
  workflows: Workflow[];
  runs: Run[];
  watching: string[];
  settings: AISettings;
  busy: boolean;
  cloud: CloudSettings;
};
export type CloudSettings = {
  baseUrl: string;
  connected: boolean;
  email?: string;
  workspaceName?: string;
  workspaceId?: string;
};
export interface StudioAPI {
  locationState(): Promise<import('./organize-location').LocationState>;
  locationPick(known?: 'downloads' | 'desktop' | 'documents'): Promise<string | null>;
  locationPrepare(input: import('./organize-location').PrepareLocation): Promise<void>;
  locationChoose(input: import('./organize-location').LocationChoice): Promise<void>;
  locationApply(id: string, revision: number): Promise<void>;
  locationUndo(id: string): Promise<void>;
  locationLoad(id: string): Promise<void>;
  locationDetails(id: string, offset: number): Promise<import('./organizer').PlanItem[]>;
  locationFolders(root: string): Promise<{ name: string; path: string }[]>;
  locationPreview(id: string, fileId: string): Promise<string>;
  locationOpen(id: string, groupId: string): Promise<void>;
  locationRule(rule: import('./organize-location').FilingRule, remove?: boolean): Promise<void>;
  locationTidy(root: string, enabled: boolean): Promise<void>;
  libraryIndex(root: string, resumeId?: string): Promise<void>;
  librarySearch(
    query: string,
    scope: string,
    offset: number,
  ): Promise<import('./organize-location').LibraryFile[]>;
  libraryOpen(id: string): Promise<void>;
  libraryForget(id: string): Promise<void>;
  libraryCollection(
    input: import('./organize-location').VirtualCollection,
    remove?: boolean,
  ): Promise<void>;
  toolboxPick(): Promise<string[]>;
  toolboxDropped(files: File[]): Promise<string[]>;
  toolboxRun(input: import('./toolbox').ToolboxInput): Promise<import('./toolbox').ToolboxResult>;
  toolboxHistory(): Promise<import('./toolbox').ToolboxResult[]>;
  toolboxPreview(file: string): Promise<string>;
  toolboxOpen(file: string, reveal: boolean): Promise<void>;
  toolboxCopy(text: string): Promise<void>;
  onToolboxProgress(
    callback: (progress: import('./toolbox').ToolboxProgress | null) => void,
  ): () => void;
  organizerState(): Promise<import('./organizer').OrganizerState>;
  onOrganizerProgress(
    callback: (progress: import('./organizer').OrganizerProgress | null) => void,
  ): () => void;
  organizerScan(options: import('./organizer').ScanOptions): Promise<void>;
  organizerResumeScan(): Promise<void>;
  organizerPlan(options: import('./organizer').PlanOptions): Promise<boolean>;
  organizerSelect(ids: string[]): Promise<void>;
  organizerApply(): Promise<void>;
  organizerUndo(): Promise<void>;
  organizerLoad(id: string): Promise<void>;
  organizerSavePreset(
    preset: Omit<import('./organizer').OrganizerPreset, 'id' | 'nextRun'> & { id?: string },
  ): Promise<void>;
  organizerRemovePreset(id: string): Promise<void>;
  organizerRunPreset(id: string): Promise<void>;
  organizerClearCache(): Promise<void>;
  snapshot(): Promise<Snapshot>;
  save(workflow: Workflow): Promise<Workflow>;
  remove(id: string): Promise<boolean>;
  chooseFolder(): Promise<string | null>;
  chooseFile(): Promise<string | null>;
  execute(id: string, source: string, preview: boolean): Promise<Run>;
  executeFolder(
    id: string,
    folder: string,
    recursive: boolean,
    preview: boolean,
  ): Promise<{ completed: number; total: number; last?: Run }>;
  cancel(): Promise<void>;
  watch(id: string, enabled: boolean): Promise<void>;
  undo(id: string): Promise<void>;
  exportWorkflow(id: string): Promise<boolean>;
  importWorkflow(): Promise<Workflow | null>;
  settings(settings: AISettings & { apiKey?: string }): Promise<AISettings>;
  testAI(): Promise<string>;
  cloudSettings(): Promise<CloudSettings>;
  cloudAuth(input: {
    mode: 'login' | 'register';
    baseUrl: string;
    email: string;
    password: string;
  }): Promise<CloudSettings>;
  cloudDisconnect(): Promise<void>;
  cloudPush(workflowId: string): Promise<void>;
  cloudPull(): Promise<Workflow[]>;
  cloudShare(workflowId: string): Promise<string>;
  onUpdate(callback: () => void): () => void;
}
