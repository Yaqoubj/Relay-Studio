export type OrganizerTemplate =
  | 'smart'
  | 'smart-ai'
  | 'combine'
  | 'cleanup'
  | 'drive'
  | 'downloads'
  | 'rename'
  | 'storage'
  | 'duplicates'
  | 'photos'
  | 'archive'
  | 'delivery'
  | 'backup'
  | 'ai-documents'
  | 'ai-receipts'
  | 'ai-meetings'
  | 'ai-research'
  | 'ai-screenshots'
  | 'ai-related'
  | 'ai-adviser';
export type FileCategory =
  'Documents' | 'Photos' | 'Videos' | 'Audio' | 'Archives' | 'Installers' | 'Other';
export type FileStamp = { size: number; mtimeMs: number; dev: number; ino: number };
export type ScannedFile = FileStamp & {
  id: string;
  path: string;
  relative: string;
  category: FileCategory;
};
export type ScanOptions = { root: string; recursive: boolean; exclude: string[] };
export type ScanResult = {
  version: 1;
  id: string;
  root: string;
  createdAt: string;
  files: ScannedFile[];
  bytes: number;
  skipped: number;
  warnings: string[];
  status: 'complete' | 'cancelled' | 'limited';
  pendingFolders?: string[];
  options?: ScanOptions;
};
export type PlanOptions = {
  template: OrganizerTemplate;
  destination: string;
  operation: 'copy' | 'move';
  preserveStructure: boolean;
  categories: FileCategory[];
  pattern: string;
  exclude: string[];
  minSizeMB?: number;
  olderThanDays?: number;
  keepFolder?: string;
  maxAIRequests?: number;
  maxCharacters?: number;
  minConfidence?: number;
  labels?: string;
  ocr?: boolean;
  placement?: 'inside' | 'subfolder' | 'elsewhere';
  subfolderName?: string;
  renameSmart?: boolean;
};
export type PlanItem = {
  id: string;
  source: string;
  destination: string;
  stamp: FileStamp;
  reason: string;
  selected: boolean;
  issue?: string;
  hash?: string;
  state:
    | 'pending'
    | 'copying'
    | 'copied'
    | 'removing'
    | 'done'
    | 'failed'
    | 'restoring'
    | 'restored'
    | 'undo-removing'
    | 'undone';
  error?: string;
  action?: 'copy' | 'move' | 'write';
  content?: string;
  sourceHash?: string;
  keeper?: { path: string; stamp: FileStamp; hash: string };
  group?: string;
};
export type OrganizationPlan = {
  version: 1;
  id: string;
  scanId: string;
  root: string;
  createdAt: string;
  options: PlanOptions;
  items: PlanItem[];
  status:
    | 'review'
    | 'running'
    | 'complete'
    | 'cancelled'
    | 'failed'
    | 'interrupted'
    | 'undoing'
    | 'undone';
  error?: string;
  notes?: string[];
  analysis?: { requests: number; cached: number; characters: number };
  createdFolders?: string[];
};
export type OrganizerProgress = { stage: string; count: number; total?: number; path?: string };
export type OrganizerState = {
  scan: ScanResult | null;
  plan: OrganizationPlan | null;
  progress: OrganizerProgress | null;
  presets?: OrganizerPreset[];
  history: {
    id: string;
    createdAt: string;
    template: OrganizerTemplate;
    status: OrganizationPlan['status'];
    count: number;
  }[];
};
export const organizerTemplates: {
  id: OrganizerTemplate;
  name: string;
  description: string;
  example: string;
  ai?: boolean;
}[] = [
  {
    id: 'smart',
    name: 'Organize this location',
    description:
      'Find related files, make useful folders, and propose moves and names in one review.',
    example: 'Downloads/Show.S02E03.mkv → Downloads/Videos/Show/Season 02',
  },
  {
    id: 'smart-ai',
    name: 'Organize with AI',
    ai: true,
    description:
      'Start with local grouping, then use your connected model to suggest document topics and names.',
    example: 'Downloads/scan.pdf → Downloads/Documents/Finance/Rental agreement.pdf',
  },
  {
    id: 'cleanup',
    name: 'Clean up storage',
    description: 'Find exact duplicates and large old files together, then review what to archive.',
    example: 'Extra copies + old videos → chosen archive folder',
  },
  {
    id: 'combine',
    name: 'Combine collections',
    description:
      'Bring files from scattered folders under one parent into a chosen library structure.',
    example: 'Old drive/Trips/*.jpg → Pictures/Trips',
  },
  {
    id: 'drive',
    name: 'Organize my drive',
    description:
      'Sort personal files by type while preserving their folder structure. Projects and system folders are skipped.',
    example: 'Trips/beach.jpg → Photos/Trips/beach.jpg',
  },
  {
    id: 'downloads',
    name: 'Downloads cleanup',
    description:
      'Group documents, media, archives, and installers into category and modification-month folders.',
    example: 'invoice.pdf → Documents/2026-09/invoice.pdf',
  },
  {
    id: 'rename',
    name: 'Bulk rename',
    description:
      'Preview names using the original name, modification date, and a sequence number. Rename files in place.',
    example: '{{date}}-{{number}}-{{stem}}{{ext}}',
  },
  {
    id: 'storage',
    name: 'Reclaim working space',
    description:
      'Find large, old files and review a move to an archive drive. Set the size and age thresholds yourself.',
    example: 'Large videos untouched for 90 days → Archive/Videos',
  },
  {
    id: 'duplicates',
    name: 'Exact duplicate review',
    description:
      'Compare file contents, keep one verified original, and review the extra copies for archiving.',
    example: 'Same bytes, different names → keep one, archive extras',
  },
  {
    id: 'photos',
    name: 'Photo library',
    description:
      'Group photos by capture month, keep same-name sidecars together, and separate files with no capture date.',
    example: 'IMG_2041.jpg → Photos/2024-07/IMG_2041.jpg',
  },
  {
    id: 'archive',
    name: 'Archive old files',
    description:
      'Collect files older than your chosen number of days while retaining their relative folder paths.',
    example: 'Reports/2023/results.pdf → Archive/Reports/2023/results.pdf',
  },
  {
    id: 'delivery',
    name: 'Prepare to share',
    description:
      'Gather selected files, flag private-looking names, and create a checksum manifest for the copies.',
    example: 'Selected documents + SHA256SUMS.txt',
  },
  {
    id: 'backup',
    name: 'Verify a backup',
    description:
      'Compare source files against a backup by relative path and hash. Propose missing copies and flag differing files.',
    example: 'Missing → copy · Different → inspect · Matching → skip',
  },
  {
    id: 'ai-documents',
    name: 'Document filing',
    ai: true,
    description:
      'Read documents and suggest an allowed category and descriptive name. Review every destination.',
    example: 'scan-004.pdf → Finance/Rental agreement.pdf',
  },
  {
    id: 'ai-receipts',
    name: 'Receipt register',
    ai: true,
    description:
      'Extract merchant, date, currency, and total into one reviewable JSON record per receipt.',
    example: 'receipt.pdf → receipt.receipt.json',
  },
  {
    id: 'ai-meetings',
    name: 'Meeting action notes',
    ai: true,
    description: 'Turn transcripts into decisions, owners, and next steps with a source reference.',
    example: 'meeting.txt → meeting.actions.md',
  },
  {
    id: 'ai-research',
    name: 'Research reading pack',
    ai: true,
    description:
      'Create concise reading notes with key claims, limitations, and open questions for each document.',
    example: 'paper.pdf → paper.reading.md',
  },
  {
    id: 'ai-screenshots',
    name: 'Screenshot filing',
    ai: true,
    description:
      'Read screenshot text locally with OCR, then ask your model to suggest a category and name.',
    example: 'Screenshot.png → Receipts/Hotel booking.png',
  },
  {
    id: 'ai-related',
    name: 'Group related documents',
    ai: true,
    description:
      'Assign documents to your named projects or topics based on their text. Uncertain matches stay out of the batch.',
    example: 'notes.pdf → Project Atlas/notes.pdf',
  },
  {
    id: 'ai-adviser',
    name: 'Organization adviser',
    ai: true,
    description:
      'Read each document and write a filing recommendation with the evidence behind it. Originals stay untouched.',
    example: 'document.pdf → document.filing-advice.md',
  },
];
export const needsAI = (template: OrganizerTemplate) =>
  template.startsWith('ai-') || template === 'smart-ai';
export type OrganizerPreset = {
  id: string;
  name: string;
  scan: ScanOptions;
  options: PlanOptions;
  everyHours: number;
  enabled: boolean;
  nextRun: string;
  lastRun?: string;
  lastPlanId?: string;
  error?: string;
};
export function organizerDefaults(template: OrganizerTemplate): PlanOptions {
  return {
    template,
    destination: '',
    operation: ['smart', 'smart-ai', 'combine', 'cleanup'].includes(template) ? 'move' : 'copy',
    preserveStructure: ['drive', 'archive', 'storage', 'delivery', 'backup'].includes(template),
    categories: ['smart', 'smart-ai', 'combine', 'cleanup'].includes(template)
      ? fileCategories
      : template === 'photos'
        ? ['Photos', 'Other']
        : template === 'ai-screenshots'
          ? ['Photos']
          : template === 'ai-receipts'
            ? ['Documents', 'Photos']
            : needsAI(template)
              ? ['Documents']
              : fileCategories.filter((c) => c !== 'Other'),
    pattern: '{{date}}-{{number}}-{{stem}}{{ext}}',
    exclude: [],
    minSizeMB: 100,
    olderThanDays: template === 'archive' ? 180 : 90,
    keepFolder: '',
    maxAIRequests: 20,
    maxCharacters: 20000,
    minConfidence: 0.8,
    labels: 'Work, Finance, Personal, Reference',
    ocr: true,
    placement: template === 'combine' ? 'elsewhere' : 'inside',
    subfolderName: 'Organized',
    renameSmart: false,
  };
}
export const fileCategories: FileCategory[] = [
  'Documents',
  'Photos',
  'Videos',
  'Audio',
  'Archives',
  'Installers',
  'Other',
];
