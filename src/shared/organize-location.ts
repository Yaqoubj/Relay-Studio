import type { FileCategory, FileStamp, OrganizationPlan } from './organizer';

export type CollectionGroup = {
  id: string;
  title: string;
  category: FileCategory;
  key: string;
  count: number;
  bytes: number;
  samples: { name: string; id: string; snippet?: string }[];
  destination: string;
  rootRef: string;
  existing: boolean;
  evidence: string[];
  issue?: string;
  kept?: boolean;
  bundleId?: string;
  selectedCount?: number;
  completedCount?: number;
};
export type FolderBundle = {
  id: string;
  source: string;
  destination: string;
  rootRef: string;
  directories: { path: string; dev: number; ino: number }[];
  files: { path: string; stamp: FileStamp; hash: string }[];
};
export type FilingRule = {
  id: string;
  scope: string;
  key: string;
  title: string;
  destination: string;
  priority: number;
  enabled: boolean;
  examples: string[];
  root?: { path: string; dev: number; ino: number };
  relative?: string;
};
export type TidyLocation = {
  id: string;
  root: string;
  dev?: number;
  ino?: number;
  enabled: boolean;
  initialized?: boolean;
  error?: string;
  lastCheck?: string;
};
export type LibraryScope = {
  id: string;
  root: string;
  dev?: number;
  ino?: number;
  status: 'ready' | 'offline' | 'partial';
  updated?: string;
  count: number;
  bytes: number;
  error?: string;
  pending?: string[];
};
export type VirtualCollection = { id: string; name: string; query: string; scope: string };
export type LibraryFile = FileStamp & {
  id: string;
  scopeId: string;
  path: string;
  relative: string;
  category: FileCategory;
  snippet: string;
  seen: string;
  contentRead?: boolean;
};
export type LocationState = {
  plan: Omit<OrganizationPlan, 'items' | 'bundles'> | null;
  unchanged: { count: number; reasons: string[] };
  rules: FilingRule[];
  tidy: TidyLocation[];
  scopes: LibraryScope[];
  collections: VirtualCollection[];
  pendingArrivals: { id: string; path: string; state: string; error?: string; planId?: string }[];
  history: { id: string; createdAt: string; status: string; count: number }[];
};
export type PrepareLocation = {
  root: string;
  evidence?: boolean;
  ocr?: boolean;
  ai?: boolean;
  bundles?: string[];
};
export type LocationChoice = {
  id: string;
  revision: number;
  groupId: string;
  selected?: boolean;
  destination?: string;
  remember?: boolean;
};
export type Arrival = {
  id: string;
  locationId: string;
  path: string;
  stamp: FileStamp;
  stableSince: number;
  state: 'waiting' | 'pending' | 'claimed' | 'done' | 'failed';
  planId?: string;
  error?: string;
};
