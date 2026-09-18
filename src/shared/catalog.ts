import type { Kind, Workflow } from './types';
export const catalog: Record<
  Kind,
  {
    name: string;
    description: string;
    group: string;
    color: string;
    defaults: Record<string, string>;
  }
> = {
  trigger: {
    name: 'Folder trigger',
    description: 'Start with a new file or a manual test',
    group: 'Trigger',
    color: 'green',
    defaults: { folder: '' },
  },
  filter: {
    name: 'Condition',
    description: 'Route by extension or text content',
    group: 'Logic',
    color: 'amber',
    defaults: { field: 'extension', operator: 'equals', value: '.pdf' },
  },
  read: {
    name: 'Read document',
    description: 'Extract text from a PDF or text file',
    group: 'Action',
    color: 'blue',
    defaults: {},
  },
  ai: {
    name: 'AI transform',
    description: 'Summarize, classify, or extract fields',
    group: 'AI',
    color: 'purple',
    defaults: {
      prompt: 'Summarize this document in five concise bullet points.',
      format: 'text',
      fields: 'company,date,total',
    },
  },
  rename: {
    name: 'Rename file',
    description: 'Give the current file a predictable name',
    group: 'Action',
    color: 'blue',
    defaults: { name: '{{date}}-{{stem}}{{ext}}' },
  },
  copy: {
    name: 'Copy file',
    description: 'Create a copy in another folder',
    group: 'Action',
    color: 'blue',
    defaults: { folder: '' },
  },
  move: {
    name: 'Move file',
    description: 'Move the current file to a chosen folder',
    group: 'Action',
    color: 'blue',
    defaults: { folder: '' },
  },
  write: {
    name: 'Write text file',
    description: 'Save extracted text or AI output',
    group: 'Action',
    color: 'blue',
    defaults: { folder: '', name: '{{stem}}-summary.md', content: '{{ai}}' },
  },
  notify: {
    name: 'Notification',
    description: 'Let yourself know when work is done',
    group: 'Action',
    color: 'pink',
    defaults: { message: 'Finished processing {{name}}' },
  },
};
function template(
  id: string,
  name: string,
  description: string,
  specs: [Kind, string, Record<string, string>?][],
): Workflow {
  return {
    id,
    name,
    description,
    updatedAt: new Date().toISOString(),
    nodes: specs.map(([kind, label, config], i) => ({
      id: `${id}-${i}`,
      type: 'step',
      position: { x: 80 + (i % 3) * 330, y: 100 + Math.floor(i / 3) * 260 },
      data: { kind, label, config: { ...catalog[kind].defaults, ...config } },
    })),
    edges: specs
      .slice(1)
      .map((_, i) => ({
        id: `${id}-edge-${i}`,
        source: `${id}-${i}`,
        target: `${id}-${i + 1}`,
        sourceHandle: specs[i][0] === 'filter' ? 'yes' : undefined,
      })),
  };
}
export function templates(): Workflow[] {
  return [
    template(
      'document-digest',
      'Document digest',
      'Turn incoming PDFs into concise, searchable summaries.',
      [
        ['trigger', 'A document arrives'],
        ['filter', 'Is it a PDF?'],
        ['read', 'Extract document text'],
        ['ai', 'Summarize the document'],
        ['write', 'Save a Markdown summary'],
        ['notify', 'Let me know it’s ready'],
      ],
    ),
    template(
      'download-sorter',
      'Download organizer',
      'Give PDFs a dated name and move them into an archive. No AI needed.',
      [
        ['trigger', 'A download arrives'],
        ['filter', 'Keep PDF files'],
        ['move', 'Move to my archive'],
        ['rename', 'Add today’s date'],
        ['notify', 'Archive complete'],
      ],
    ),
    template(
      'meeting-notes',
      'Meeting follow-up',
      'Transform a text transcript into decisions and action items.',
      [
        ['trigger', 'A transcript arrives'],
        ['read', 'Read the transcript'],
        [
          'ai',
          'Find decisions & actions',
          {
            prompt:
              'Create Markdown meeting notes with sections: Summary, Decisions, Action items. Do not invent owners or deadlines. Mark missing details as unspecified.',
          },
        ],
        ['write', 'Save meeting notes'],
        ['notify', 'Notes are ready'],
      ],
    ),
  ];
}
export function blankWorkflow(): Workflow {
  const id = crypto.randomUUID();
  return template(id, 'Untitled workflow', 'Describe what this workflow takes care of.', [
    ['trigger', 'A file arrives'],
  ]);
}
