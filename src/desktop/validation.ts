import path from 'node:path';
import { catalog } from '../shared/catalog';
import type { Workflow } from '../shared/types';
export function validateWorkflow(value: unknown): Workflow {
  if (!value || typeof value !== 'object' || JSON.stringify(value).length > 200000)
    throw new Error('Invalid or oversized workflow.');
  const w = structuredClone(value) as Workflow;
  if (
    typeof w.id !== 'string' ||
    !/^[\w-]{1,80}$/.test(w.id) ||
    typeof w.name !== 'string' ||
    !w.name.trim() ||
    w.name.length > 100
  )
    throw new Error('Give the workflow a name (up to 100 characters).');
  if (typeof w.description !== 'string' || w.description.length > 1000)
    throw new Error('Description is too long.');
  if (
    !Array.isArray(w.nodes) ||
    w.nodes.length < 1 ||
    w.nodes.length > 40 ||
    !Array.isArray(w.edges) ||
    w.edges.length > 60
  )
    throw new Error('Use between 1 and 40 steps.');
  const ids = new Set<string>();
  for (const n of w.nodes) {
    if (typeof n.id !== 'string' || !/^[\w-]{1,100}$/.test(n.id) || ids.has(n.id))
      throw new Error('Every step needs a unique ID.');
    ids.add(n.id);
    if (
      !n.data ||
      !Object.hasOwn(catalog, n.data.kind) ||
      typeof n.data.label !== 'string' ||
      n.data.label.length > 100
    )
      throw new Error('Unknown step type or invalid label.');
    if (!n.data.config || typeof n.data.config !== 'object' || Array.isArray(n.data.config))
      throw new Error('Invalid step settings.');
    for (const v of Object.values(n.data.config))
      if (typeof v !== 'string' || v.length > 20000) throw new Error('Invalid step setting.');
    if (!n.position || !Number.isFinite(n.position.x) || !Number.isFinite(n.position.y))
      throw new Error('Invalid step position.');
    n.type = 'step';
    delete n.data.state;
  }
  const triggers = w.nodes.filter((n) => n.data.kind === 'trigger');
  if (triggers.length !== 1) throw new Error('A workflow needs exactly one folder trigger.');
  const edgeIds = new Set<string>();
  for (const e of w.edges) if (e.sourceHandle == null) delete e.sourceHandle;
  for (const e of w.edges) {
    if (
      typeof e.id !== 'string' ||
      edgeIds.has(e.id) ||
      !ids.has(e.source) ||
      !ids.has(e.target) ||
      e.source === e.target
    )
      throw new Error('Invalid connection.');
    edgeIds.add(e.id);
    const source = w.nodes.find((n) => n.id === e.source)!;
    if (source.data.kind === 'filter' && !['yes', 'no'].includes(e.sourceHandle || ''))
      throw new Error('Connect a condition using its Yes or No output.');
    if (source.data.kind !== 'filter' && e.sourceHandle)
      throw new Error('Only conditions have named outputs.');
    if (
      w.edges.filter((other) => other.source === e.source && other.sourceHandle === e.sourceHandle)
        .length > 1
    )
      throw new Error('Each output can connect to one next step.');
    if (w.edges.filter((other) => other.target === e.target).length > 1)
      throw new Error('Merging branches is not supported. Give each branch its own steps.');
    if (e.target === triggers[0].id) throw new Error('The trigger cannot have an input.');
  }
  const visited = new Set<string>(),
    visiting = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id))
      throw new Error('Loops are not supported. Remove the circular connection.');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const e of w.edges.filter((e) => e.source === id)) visit(e.target);
    visiting.delete(id);
    visited.add(id);
  }
  // Inspect disconnected components too; drafts may contain disconnected steps.
  for (const id of ids) visit(id);
  return w;
}
export function validateRunnable(w: Workflow) {
  validateWorkflow(w);
  const reached = new Set<string>();
  const visit = (id: string) => {
    reached.add(id);
    w.edges.filter((e) => e.source === id).forEach((e) => visit(e.target));
  };
  visit(w.nodes.find((n) => n.data.kind === 'trigger')!.id);
  if (reached.size !== w.nodes.length)
    throw new Error('Connect every step to the trigger before running.');
  if (w.nodes.length < 2) throw new Error('Add and connect at least one action.');
  for (const n of w.nodes) {
    const { kind, config } = n.data;
    if (
      ['copy', 'move', 'write'].includes(kind) &&
      (!config.folder || !path.isAbsolute(config.folder))
    )
      throw new Error(`Choose a destination folder for “${n.data.label}”.`);
    if (['rename', 'write'].includes(kind) && !config.name?.trim())
      throw new Error(`Set a file name for “${n.data.label}”.`);
    if (
      kind === 'filter' &&
      (!['extension', 'name', 'text', 'ai'].includes(config.field) ||
        !['equals', 'contains'].includes(config.operator) ||
        !config.value)
    )
      throw new Error('Complete the condition settings.');
    if (kind === 'ai' && (!config.prompt?.trim() || !['text', 'json'].includes(config.format)))
      throw new Error('Configure the AI instructions and output format.');
  }
}
export function safeName(name: string): string {
  if (
    !name ||
    name.length > 180 ||
    /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name) ||
    ['.', '..'].includes(name)
  )
    throw new Error(
      'The generated file name is unsafe. Use a plain file name without folders or reserved characters.',
    );
  return name;
}
