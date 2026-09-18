import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Workflow, Run, Config, Effect } from '../shared/types';
import { safeName, validateRunnable } from './validation';
type Context = {
  file: string;
  physical: string;
  text: string;
  ai: string;
  date: string;
  fields: Record<string, string>;
  aiUnknown: boolean;
};
export type Services = {
  update: (run: Run) => void;
  ai: (text: string, config: Config, signal: AbortSignal) => Promise<string>;
  notify: (message: string) => void;
  signal: AbortSignal;
  allowFolder: (folder: string) => Promise<void>;
};
export async function digest(file: string) {
  return createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex');
}
async function regular(file: string) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('Only regular files are supported; symbolic links are not processed.');
  if (stat.size > 25 * 1024 * 1024) throw new Error('The file exceeds the 25 MB limit.');
}
async function vacant(file: string) {
  try {
    await fs.lstat(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
  throw new Error(`Destination already exists: ${path.basename(file)}. Nothing was overwritten.`);
}
export function renderTemplate(input: string, ctx: Context): string {
  const vars: Record<string, string> = {
    name: path.basename(ctx.file),
    stem: path.parse(ctx.file).name,
    ext: path.extname(ctx.file),
    date: ctx.date,
    text: ctx.text,
    ai: ctx.ai,
  };
  return input.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    if (key.startsWith('ai.')) {
      const field = key.slice(3);
      if (!Object.hasOwn(ctx.fields, field)) throw new Error(`Missing AI field: ${field}`);
      return ctx.fields[field];
    }
    if (!Object.hasOwn(vars, key)) throw new Error(`Unknown variable: ${key}`);
    return vars[key];
  });
}
async function readDocument(file: string): Promise<string> {
  await regular(file);
  if (path.extname(file).toLowerCase() === '.pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: await fs.readFile(file) });
    try {
      const result = await parser.getText();
      if (!result.text.trim())
        throw new Error(
          'This PDF has no extractable text. Scanned PDFs need OCR, which is not included.',
        );
      return result.text;
    } finally {
      await parser.destroy();
    }
  }
  if (
    !['.txt', '.md', '.csv', '.json', '.log', '.html', '.xml', '.yaml', '.yml'].includes(
      path.extname(file).toLowerCase(),
    )
  )
    throw new Error(
      'Read document supports text, Markdown, CSV, JSON, logs, HTML, XML, YAML, and text-based PDFs.',
    );
  const text = await fs.readFile(file, 'utf8');
  if (text.includes('\0')) throw new Error('The file appears to be binary.');
  return text;
}
export async function execute(
  workflow: Workflow,
  source: string,
  preview: boolean,
  origin: Run['origin'],
  services: Services,
): Promise<Run> {
  validateRunnable(workflow);
  const run: Run = {
    id: randomUUID(),
    workflowId: workflow.id,
    workflowName: workflow.name,
    workflow: structuredClone(workflow),
    source,
    preview,
    origin,
    status: 'running',
    startedAt: new Date().toISOString(),
    steps: [],
  };
  const ctx: Context = {
    file: path.resolve(source),
    physical: path.resolve(source),
    text: '',
    ai: '',
    fields: {},
    date: new Date().toISOString().slice(0, 10),
    aiUnknown: false,
  };
  services.update(run);
  let node = workflow.nodes.find((n) => n.data.kind === 'trigger');
  try {
    await regular(ctx.file);
    // Validate all configured destinations before performing any action.
    for (const n of workflow.nodes)
      if (['copy', 'move', 'write'].includes(n.data.kind))
        await services.allowFolder(n.data.config.folder);
    while (node) {
      services.signal.throwIfAborted();
      const started = Date.now(),
        { kind, config, label } = node.data;
      const result: Run['steps'][number] = {
        nodeId: node.id,
        label,
        kind,
        status: 'running',
        startedAt: new Date().toISOString(),
        duration: 0,
        input: ctx.file,
        output: '',
      };
      run.steps.push(result);
      services.update(run);
      let branch: string | undefined;
      try {
        if (kind === 'trigger') result.output = `Received ${path.basename(ctx.file)}`;
        if (kind === 'filter') {
          if (preview && config.field === 'ai' && ctx.aiUnknown) {
            result.output =
              'Branch depends on an AI result. Preview ends here; no AI request was sent.';
            result.status = 'skipped';
            node = undefined;
          } else {
            const value = (
              {
                extension: path.extname(ctx.file),
                name: path.basename(ctx.file),
                text: ctx.text,
                ai: ctx.ai,
              } as Record<string, string>
            )[config.field].toLowerCase();
            const match =
              config.operator === 'equals'
                ? value === config.value.toLowerCase()
                : value.includes(config.value.toLowerCase());
            branch = match ? 'yes' : 'no';
            result.output = `${match ? 'Yes' : 'No'} — ${config.field} ${config.operator} “${config.value}”`;
          }
        }
        if (kind === 'read') {
          ctx.text = await readDocument(ctx.physical);
          result.output = ctx.text.slice(0, 5000);
        }
        if (kind === 'ai') {
          if (preview) {
            ctx.aiUnknown = true;
            result.status = 'skipped';
            result.output =
              'AI request skipped in preview. Downstream AI-dependent actions are shown as unresolved.';
          } else {
            ctx.ai = await services.ai(ctx.text, config, services.signal);
            ctx.fields = config.format === 'json' ? JSON.parse(ctx.ai) : {};
            result.output = ctx.ai.slice(0, 5000);
          }
        }
        if (['rename', 'copy', 'move', 'write'].includes(kind)) {
          if (
            preview &&
            ctx.aiUnknown &&
            /\{\{\s*ai[.\s}]/.test((config.name || '') + (config.content || ''))
          ) {
            result.status = 'skipped';
            result.output =
              'Planned file action depends on AI output; destination/content cannot be resolved in preview.';
            if (kind === 'rename') node = undefined;
          } else {
            const folder =
              kind === 'rename' ? path.dirname(ctx.file) : await fs.realpath(config.folder);
            const name = ['rename', 'write'].includes(kind)
              ? safeName(renderTemplate(config.name, ctx))
              : path.basename(ctx.file);
            const destination = path.join(folder, name);
            if (path.resolve(destination) === path.resolve(ctx.file))
              throw new Error('Source and destination are the same file.');
            await vacant(destination);
            result.output = `${preview ? 'Would ' : ''}${kind}: ${destination}`;
            if (!preview) {
              services.signal.throwIfAborted();
              if (kind === 'write') {
                const content = renderTemplate(config.content || '', ctx);
                if (content.length > 1000000)
                  throw new Error('Generated text exceeds the 1 MB limit.');
                await fs.writeFile(destination, content, { flag: 'wx', encoding: 'utf8' });
                result.effect = {
                  type: 'create',
                  path: destination,
                  hash: createHash('sha256').update(content).digest('hex'),
                };
              } else {
                await regular(ctx.physical);
                const hash = await digest(ctx.physical);
                await fs.copyFile(ctx.physical, destination, constants.COPYFILE_EXCL);
                // Journal the copied file before removing the source.
                result.effect = { type: 'create', path: destination, hash };
                services.update(run);
                if (kind === 'move' || kind === 'rename') {
                  if ((await digest(ctx.physical)) !== hash || (await digest(destination)) !== hash)
                    throw new Error(
                      'The file changed during the operation. Both copies have been kept.',
                    );
                  await fs.unlink(ctx.physical);
                  result.effect = { type: 'move', path: destination, original: ctx.physical, hash };
                  ctx.physical = destination;
                }
              }
              services.update(run);
            }
            if (kind === 'move' || kind === 'rename') ctx.file = destination;
          }
        }
        if (kind === 'notify') {
          result.output =
            preview && ctx.aiUnknown && config.message.includes('{{ai')
              ? 'Notification depends on AI output.'
              : renderTemplate(config.message || 'Workflow complete', ctx);
          if (!preview) services.notify(result.output.slice(0, 250));
        }
        if (result.status === 'running') result.status = preview ? 'preview' : 'success';
      } catch (error) {
        result.status = 'failed';
        result.output = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        result.duration = Date.now() - started;
        services.update(run);
      }
      const edge =
        node &&
        workflow.edges.find(
          (e) => e.source === node!.id && (kind !== 'filter' || e.sourceHandle === branch),
        );
      node = edge ? workflow.nodes.find((n) => n.id === edge.target) : undefined;
    }
    run.status = 'success';
  } catch (error) {
    run.status = services.signal.aborted ? 'cancelled' : 'failed';
    run.error = error instanceof Error ? error.message : String(error);
  }
  run.finishedAt = new Date().toISOString();
  services.update(run);
  return run;
}
export async function undoRun(run: Run, save: (r: Run) => void) {
  if (run.status === 'running' || run.preview || run.undone)
    throw new Error('This run cannot be undone.');
  for (const step of [...run.steps].reverse()) {
    const effect: Effect | undefined = step.effect;
    if (!effect || effect.undone) continue;
    await regular(effect.path);
    if ((await digest(effect.path)) !== effect.hash)
      throw new Error(`Cannot undo: ${path.basename(effect.path)} was changed after this run.`);
    if (effect.type === 'move' && effect.original) {
      await vacant(effect.original);
      await fs.copyFile(effect.path, effect.original, constants.COPYFILE_EXCL);
      if ((await digest(effect.original)) !== effect.hash)
        throw new Error('Restored file could not be verified. Both copies have been kept.');
    }
    await fs.unlink(effect.path);
    effect.undone = true;
    save(run);
  }
  run.undone = true;
  save(run);
}
