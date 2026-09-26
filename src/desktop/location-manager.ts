import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Store } from './database';
import type { OrganizationPlan, OrganizerProgress } from '../shared/organizer';
import type {
  Arrival,
  CollectionGroup,
  FilingRule,
  LibraryScope,
  LocationChoice,
  LocationState,
  PrepareLocation,
  TidyLocation,
  VirtualCollection,
} from '../shared/organize-location';
import { prepareLocation, rootIdentity, checkCollisions } from './organize-location';
import {
  applyPlan,
  undoPlan,
  scanFiles,
  stampOf,
  verifySource,
  within,
  checkPath,
} from './organizer';
import { extractDocument } from './documents';
import type { AnalysisServices } from './collection-analysis';

const samePath = (a: string, b: string) =>
  process.platform === 'win32'
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b);
const pathKey = (value: string) =>
  process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const sameStamp = (a: Arrival['stamp'], b: Arrival['stamp']) =>
  a.size === b.size && a.mtimeMs === b.mtimeMs && a.dev === b.dev && a.ino === b.ino;
type Dependencies = {
  allowFolder: (folder: string) => Promise<void>;
  progress: (p: OrganizerProgress) => void;
  services: () => AnalysisServices;
  changed: () => void;
};
export class LocationManager {
  constructor(
    readonly store: Store,
    readonly deps: Dependencies,
  ) {
    // An interrupted claim is not retried: its durable journal may contain effects.
    for (const arrival of store.records<Arrival>('arrival'))
      if (arrival.state === 'claimed') {
        arrival.state = 'failed';
        arrival.error = 'Interrupted filing. Inspect its recorded batch before retrying.';
        store.record('arrival', arrival.id, arrival);
      }
  }
  current(): OrganizationPlan | null {
    const id = this.store.get('location-current');
    return id ? this.store.organizationPlan(id) : null;
  }
  state(): LocationState {
    const plan = this.current();
    const { items: _items, bundles: _bundles, ...metadata } = plan || { items: [], bundles: [] };
    const counts = new Map<string, { selectedCount: number; completedCount: number }>();
    for (const item of plan?.items || []) {
      const count = counts.get(item.group || '') || { selectedCount: 0, completedCount: 0 };
      if (item.selected && !item.issue) count.selectedCount++;
      if (item.state === 'done') count.completedCount++;
      counts.set(item.group || '', count);
    }
    if (plan && 'groups' in metadata)
      metadata.groups = plan.groups?.map((group) => ({ ...group, ...counts.get(group.id) }));
    return {
      plan: plan ? (metadata as LocationState['plan']) : null,
      unchanged: {
        count:
          (plan?.preserved?.outsidePlan || 0) +
          (plan?.items.filter((item) => !item.selected && item.state !== 'done').length || 0),
        reasons: plan?.preserved?.reasons || [],
      },
      rules: this.store.records('rule'),
      tidy: this.store.records('tidy'),
      scopes: this.store.records('scope'),
      collections: this.store.records('collection'),
      pendingArrivals: this.store
        .records<Arrival>('arrival')
        .filter((item) => ['pending', 'failed'].includes(item.state))
        .slice(-100)
        .map(({ id, path, state, error, planId }) => ({ id, path, state, error, planId })),
      history: this.store.organizationHistory(2),
    };
  }
  async prepare(input: PrepareLocation, signal: AbortSignal) {
    if (
      !input ||
      typeof input.root !== 'string' ||
      !path.isAbsolute(input.root) ||
      ['evidence', 'ocr', 'ai'].some(
        (key) =>
          input[key as 'evidence'] !== undefined && typeof input[key as 'evidence'] !== 'boolean',
      ) ||
      (input.bundles !== undefined &&
        (!Array.isArray(input.bundles) ||
          input.bundles.length > 10 ||
          input.bundles.some((p) => typeof p !== 'string' || !path.isAbsolute(p))))
    )
      throw new Error('Choose a source and valid analysis options.');
    await this.deps.allowFolder(input.root);
    for (const rule of this.store
      .records<FilingRule>('rule')
      .filter((rule) => rule.enabled && samePath(rule.scope, input.root)))
      await this.deps.allowFolder(rule.root?.path || rule.destination).catch(() => {}); // Resolver marks unavailable choices pending.
    const result = await prepareLocation(
      input,
      signal,
      this.deps.services(),
      this.store.records('rule'),
    );
    for (const root of Object.values(result.plan.roots!)) await this.deps.allowFolder(root.path);
    result.plan.preserved = {
      outsidePlan:
        result.unchanged.count - result.plan.items.filter((item) => !item.selected).length,
      reasons: result.unchanged.reasons,
    };
    this.store.putOrganizationPlan(result.plan, undefined, true);
    this.store.set('location-current', result.plan.id);
    this.store.set('location-unchanged', JSON.stringify(result.unchanged));
    this.deps.changed();
  }
  requireReview(id: string, revision: number) {
    const plan = this.current();
    if (!plan || plan.id !== id || plan.revision !== revision || plan.status !== 'review')
      throw new Error('This review changed. Refresh it before organizing.');
    return plan;
  }
  async choose(choice: LocationChoice, signal: AbortSignal) {
    if (
      !choice ||
      typeof choice.groupId !== 'string' ||
      (choice.selected !== undefined && typeof choice.selected !== 'boolean') ||
      (choice.remember !== undefined && typeof choice.remember !== 'boolean')
    )
      throw new Error('Invalid collection choice.');
    let plan = this.requireReview(choice.id, choice.revision);
    const foundGroup = plan.groups?.find((group) => group.id === choice.groupId);
    if (!foundGroup) throw new Error('Collection not found.');
    let group: CollectionGroup = foundGroup;
    if (choice.destination !== undefined) {
      if (group.key.startsWith('pending:')) throw new Error('Unsupported files stay here.');
      if (typeof choice.destination !== 'string') throw new Error('Choose a folder.');
      await this.deps.allowFolder(choice.destination);
      const identity = await rootIdentity(choice.destination);
      plan = this.requireReview(choice.id, choice.revision); // Permissions/IO can yield; never apply an old revision.
      const refreshedGroup = plan.groups?.find((group) => group.id === choice.groupId);
      if (!refreshedGroup) throw new Error('Collection no longer exists. Prepare the location again.');
      group = refreshedGroup;
      const ref = `chosen:${group.id}`;
      plan.roots![ref] = identity;
      const bundleChoice = plan.bundles?.find((bundle) => bundle.id === group.bundleId);
      const groupDestination = bundleChoice
        ? path.join(identity.path, path.basename(bundleChoice.source))
        : identity.path;
      if (
        bundleChoice &&
        (within(bundleChoice.source, groupDestination) ||
          within(groupDestination, bundleChoice.source))
      )
        throw new Error('Choose a separate collection destination.');
      group.rootRef = ref;
      group.destination = groupDestination;
      group.existing = !bundleChoice;
      group.issue = undefined;
      group.kept = false;
      for (const item of plan.items.filter((item) => item.group === group.id)) {
        const bundle = plan.bundles?.find((bundle) => bundle.id === item.bundleId);
        item.destination = path.join(
          groupDestination,
          bundle ? path.relative(bundle.source, item.source) : path.basename(item.source),
        );
        item.rootRef = ref;
        item.issue = samePath(item.source, item.destination) ? 'Already here' : undefined;
        item.selected = !item.issue;
      }
      const bundle = plan.bundles?.find((bundle) => bundle.id === group.bundleId);
      if (bundle) {
        bundle.rootRef = ref;
        bundle.destination = groupDestination;
      }
      if (choice.remember) {
        if (group.bundleId)
          throw new Error('Whole folder moves are explicit; they cannot become automatic rules.');
        this.remember(plan, group.id);
      }
    } else if (choice.remember) this.remember(plan, group.id);
    if (choice.selected !== undefined) {
      group.kept = !choice.selected;
      for (const item of plan.items.filter((item) => item.group === group.id))
        item.selected = choice.selected && !item.issue;
    }
    await checkCollisions(plan, signal);
    plan.revision = (plan.revision || 0) + 1;
    this.store.putOrganizationPlan(plan, undefined, true);
    this.deps.changed();
  }
  remember(plan: OrganizationPlan, groupId: string) {
    const group = plan.groups!.find((group) => group.id === groupId)!;
    if (group.bundleId || group.issue || group.key.startsWith('pending:'))
      throw new Error('Only a resolved file collection can be remembered.');
    const root = plan.roots![group.rootRef];
    if (!root || !within(root.path, group.destination)) throw new Error('Invalid remembered root.');
    this.checkTidyLoops(
      this.store
        .records<FilingRule>('rule')
        .concat({
          id: group.id,
          scope: plan.root,
          key: group.key,
          title: group.title,
          destination: group.destination,
          priority: 0,
          enabled: true,
          examples: [],
        }),
    );
    const prior = this.store
      .records<FilingRule>('rule')
      .find(
        (rule) =>
          rule.key === group.key &&
          samePath(rule.scope, plan.root) &&
          samePath(rule.destination, group.destination),
      );
    this.store.record('rule', prior?.id || group.id, {
      id: prior?.id || group.id,
      scope: plan.root,
      key: group.key,
      title: group.title,
      destination: group.destination,
      root,
      relative: path.relative(root.path, group.destination),
      priority: 0,
      enabled: true,
      examples: group.samples.map((sample) => sample.name),
    } satisfies FilingRule);
  }
  async apply(id: string, revision: number, signal: AbortSignal) {
    let plan = this.requireReview(id, revision);
    await this.deps.allowFolder(plan.root);
    for (const root of Object.values(plan.roots!)) await this.deps.allowFolder(root.path);
    plan = this.requireReview(id, revision);
    await applyPlan(
      plan,
      signal,
      (p, item) => this.store.putOrganizationPlan(p, item),
      this.deps.progress,
    );
    const donePaths = new Set(
      plan.items.filter((item) => item.state === 'done').map((item) => pathKey(item.source)),
    );
    for (const arrival of this.store
      .records<Arrival>('arrival')
      .filter((item) => donePaths.has(pathKey(item.path)))) {
      arrival.state = 'done';
      arrival.planId = plan.id;
      arrival.error = undefined;
      this.store.record('arrival', arrival.id, arrival);
    }
    this.deps.changed();
  }
  async undo(id: string, signal: AbortSignal) {
    const plan = this.store.organizationPlan(id);
    if (plan.version !== 2) throw new Error('Open specialized batches in Advanced.');
    await this.deps.allowFolder(plan.root);
    for (const root of Object.values(plan.roots!)) await this.deps.allowFolder(root.path);
    for (const location of this.store
      .records<TidyLocation>('tidy')
      .filter((item) => samePath(item.root, plan.root))) {
      location.enabled = false;
      location.error = 'Paused for undo. Restored files need a manual review.';
      this.store.record('tidy', location.id, location);
    }
    await undoPlan(
      plan,
      signal,
      (p, item) => this.store.putOrganizationPlan(p, item),
      this.deps.progress,
    );
    for (const item of plan.items.filter((item) => item.state === 'undone')) {
      const arrival = this.store
        .records<Arrival>('arrival')
        .find((arrival) => samePath(arrival.path, item.source));
      if (!arrival) continue;
      try {
        arrival.stamp = stampOf(await fs.lstat(item.source));
        arrival.state = 'pending';
        arrival.error = 'Restored by undo. Prepare a manual review.';
        this.store.record('arrival', arrival.id, arrival);
      } catch {
        /* Partial undo retains its journal. */
      }
    }
    this.deps.changed();
  }
  details(id: string, offset: number) {
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid page.');
    return this.store.organizationPlan(id).items.slice(offset, offset + 100);
  }
  load(id: string) {
    if (this.store.organizationPlan(id).version !== 2) throw new Error('Not a location review.');
    this.store.set('location-current', id);
    this.deps.changed();
  }
  async editRule(input: FilingRule, remove = false) {
    const previous = this.store.records<FilingRule>('rule').find((rule) => rule.id === input?.id);
    if (!previous) throw new Error('Remember a collection destination first.');
    if (remove) this.store.removeRecord('rule', previous.id);
    else {
      if (
        typeof input.enabled !== 'boolean' ||
        !Number.isInteger(input.priority) ||
        Math.abs(input.priority) > 100 ||
        typeof input.title !== 'string' ||
        !input.title.trim() ||
        input.title.length > 100
      )
        throw new Error('Choose a name and priority from -100 to 100.');
      let destination = previous.destination,
        root = previous.root,
        relative = previous.relative;
      if (!samePath(input.destination, previous.destination)) {
        await this.deps.allowFolder(input.destination);
        root = await rootIdentity(input.destination);
        destination = root.path;
        relative = '';
      }
      const updated = {
        ...previous,
        title: input.title.trim(),
        enabled: input.enabled,
        priority: input.priority,
        destination,
        root,
        relative,
      };
      this.checkTidyLoops(
        this.store
          .records<FilingRule>('rule')
          .filter((rule) => rule.id !== previous.id)
          .concat(updated),
      );
      this.store.record('rule', previous.id, updated);
    }
    // Stored rules change future preparation; invalidate an outstanding review explicitly.
    const plan = this.current();
    if (plan?.status === 'review') {
      plan.revision!++;
      this.store.putOrganizationPlan(plan);
    }
    this.deps.changed();
  }
  async tidy(root: string, enabled: boolean, signal = new AbortController().signal) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid tidy setting.');
    await this.deps.allowFolder(root);
    const identity = await rootIdentity(root);
    if (
      enabled &&
      !this.store
        .records<FilingRule>('rule')
        .some((rule) => rule.enabled && samePath(rule.scope, identity.path))
    )
      throw new Error('Remember at least one filing choice for this location first.');
    const prior = this.store
      .records<TidyLocation>('tidy')
      .find((item) => samePath(item.root, identity.path));
    const location: TidyLocation = {
      id: prior?.id || randomUUID(),
      root: identity.path,
      dev: identity.dev,
      ino: identity.ino,
      enabled,
      initialized: prior?.initialized,
    };
    this.checkTidyLoops(
      this.store.records('rule'),
      this.store
        .records<TidyLocation>('tidy')
        .filter((item) => item.id !== location.id)
        .concat(location),
    );
    if (enabled && !prior?.initialized) {
      const baseline = await scanFiles(
        { root: identity.path, recursive: false, exclude: [] },
        signal,
        this.deps.progress,
      );
      signal.throwIfAborted();
      if (baseline.files.length > 10000)
        throw new Error(
          'Choose a location with fewer than 10,000 loose files for automatic filing.',
        );
      for (const file of baseline.files) {
        const arrival: Arrival = {
          id: randomUUID(),
          locationId: location.id,
          path: file.path,
          stamp: stampOf(file),
          stableSince: Date.now(),
          state: 'pending',
          error: 'Present when automatic filing was enabled. Prepare a manual review.',
        };
        this.store.record('arrival', arrival.id, arrival);
      }
      location.initialized = true;
    }
    this.store.record('tidy', location.id, location);
    this.deps.changed();
  }
  checkTidyLoops(rules: FilingRule[], locations = this.store.records<TidyLocation>('tidy')) {
    const active = locations.filter((location) => location.enabled);
    for (const location of active)
      for (const rule of rules.filter(
        (rule) => rule.enabled && samePath(rule.scope, location.root),
      ))
        if (
          active.some((other) => other.id !== location.id && samePath(other.root, rule.destination))
        )
          throw new Error(
            'A filing destination is watched by another tidy location. Pause that location or choose a subfolder to avoid a filing loop.',
          );
  }
  async pulse(signal: AbortSignal, now = Date.now()) {
    for (const location of this.store
      .records<TidyLocation>('tidy')
      .filter((item) => item.enabled)) {
      signal.throwIfAborted();
      try {
        await this.deps.allowFolder(location.root);
        const identity = await rootIdentity(location.root);
        if (
          location.dev !== undefined &&
          (location.dev !== identity.dev || location.ino !== identity.ino)
        )
          throw new Error(
            'Tidy source was disconnected or replaced. Choose it again before enabling filing.',
          );
        const scan = await scanFiles(
          { root: location.root, recursive: false, exclude: [] },
          signal,
          this.deps.progress,
        );
        if (scan.files.length > 10000)
          throw new Error(
            'Automatic filing paused: more than 10,000 loose files. Organize a manual batch first.',
          );
        const arrivals = this.store
          .records<Arrival>('arrival')
          .filter((item) => item.locationId === location.id);
        const previousByPath = new Map(arrivals.map((arrival) => [pathKey(arrival.path), arrival]));
        const ready = new Set<string>();
        for (const file of scan.files) {
          const stamp = stampOf(file),
            prior = previousByPath.get(pathKey(file.path));
          const arrival: Arrival =
            prior && sameStamp(prior.stamp, stamp)
              ? prior
              : {
                  id: prior?.id || randomUUID(),
                  locationId: location.id,
                  path: file.path,
                  stamp,
                  stableSince: now,
                  state: 'waiting',
                };
          if (arrival.state === 'waiting' && now - arrival.stableSince >= 10000)
            ready.add(file.path);
          if (!prior || !sameStamp(prior.stamp, stamp))
            this.store.record('arrival', arrival.id, arrival);
        }
        if (ready.size) {
          const rules = this.store
            .records<FilingRule>('rule')
            .filter((rule) => rule.enabled && samePath(rule.scope, location.root));
          const { plan } = await prepareLocation(
            { root: location.root, evidence: true },
            signal,
            this.deps.services(),
            rules,
          );
          const eligibleGroups = new Set(
            plan
              .groups!.filter(
                (group) =>
                  !group.issue &&
                  rules.some(
                    (rule) =>
                      rule.key === group.key && samePath(rule.destination, group.destination),
                  ),
              )
              .map((group) => group.id),
          );
          // Wait for every related member to be stable; outputs/subdirectories are never watched.
          const blockedSets = new Set(
            plan.items.filter((item) => !ready.has(item.source)).map((item) => item.setId),
          );
          for (const item of plan.items)
            item.selected =
              item.selected &&
              eligibleGroups.has(item.group!) &&
              ready.has(item.source) &&
              !blockedSets.has(item.setId);
          const selected = plan.items.filter((item) => item.selected);
          if (selected.length) {
            // Every recorded root is checked by the executor, including roots of excluded groups.
            for (const root of Object.values(plan.roots!)) await this.deps.allowFolder(root.path);
            this.store.putOrganizationPlan(plan, undefined, true);
            for (const arrival of this.store
              .records<Arrival>('arrival')
              .filter((a) => ready.has(a.path))) {
              arrival.state = selected.some((item) => samePath(item.source, arrival.path))
                ? 'claimed'
                : 'pending';
              arrival.planId = plan.id;
              this.store.record('arrival', arrival.id, arrival);
            }
            await applyPlan(
              plan,
              signal,
              (p, item) => this.store.putOrganizationPlan(p, item),
              this.deps.progress,
            );
            for (const arrival of this.store
              .records<Arrival>('arrival')
              .filter((a) => a.planId === plan.id && a.state === 'claimed')) {
              const item = plan.items.find((item) => samePath(item.source, arrival.path));
              arrival.state = item?.state === 'done' ? 'done' : 'failed';
              arrival.error = item?.error || plan.error;
              this.store.record('arrival', arrival.id, arrival);
            }
            if (plan.status !== 'complete')
              throw new Error(plan.error || 'Automatic batch stopped. Inspect Activity.');
          } else
            for (const arrival of this.store
              .records<Arrival>('arrival')
              .filter((a) => ready.has(a.path))) {
              arrival.state = 'pending';
              this.store.record('arrival', arrival.id, arrival);
            }
        }
        // Bound arrival retention without removing unresolved recovery records.
        const completed = this.store
          .records<Arrival>('arrival')
          .filter((a) => a.locationId === location.id && a.state === 'done');
        for (const arrival of completed.slice(0, Math.max(0, completed.length - 2000)))
          this.store.removeRecord('arrival', arrival.id);
        location.lastCheck = new Date(now).toISOString();
        location.error = undefined;
      } catch (error) {
        location.enabled = false;
        location.error = (error as Error).message;
      }
      this.store.record('tidy', location.id, location);
    }
    this.deps.changed();
  }
  async index(root: string, signal: AbortSignal, resumeId?: string) {
    await this.deps.allowFolder(root);
    const identity = await rootIdentity(root);
    const previous = this.store
      .records<LibraryScope>('scope')
      .find((scope) => samePath(scope.root, identity.path));
    const scope: LibraryScope = previous || {
      id: randomUUID(),
      root: identity.path,
      dev: identity.dev,
      ino: identity.ino,
      status: 'partial',
      count: 0,
      bytes: 0,
    };
    if (!previous && this.store.records('scope').length >= 20)
      throw new Error('Remove an index before adding more (limit 20).');
    if (scope.dev !== undefined && (scope.dev !== identity.dev || scope.ino !== identity.ino))
      throw new Error('This library folder was replaced. Remove its index and choose it again.');
    const options = { root: identity.path, recursive: true, exclude: [] };
    const saved = resumeId
      ? JSON.parse(this.store.get(`library-scan:${scope.id}`) || 'null')
      : undefined;
    if (resumeId && resumeId !== scope.id) throw new Error('Invalid library section.');
    const scan = await scanFiles(options, signal, this.deps.progress, saved || undefined);
    if (scan.status === 'cancelled')
      throw new Error('Library scan cancelled. Its previous index was retained.');
    const seen = saved?.inventorySeen || new Date().toISOString();
    let count = 0,
      extracted = 0;
    for (const file of scan.files) {
      signal.throwIfAborted();
      const id = createHash('sha256').update(`${scope.id}\0${file.path}`).digest('hex');
      const prior = this.store.indexedFile(id);
      let snippet = prior && sameStamp(prior, file) ? prior.snippet : '';
      let contentRead = prior && sameStamp(prior, file) ? prior.contentRead : false;
      if (!contentRead && file.category === 'Documents' && extracted < 100) {
        extracted++;
        contentRead = true;
        try {
          await verifySource({ source: file.path, stamp: file });
          snippet = (
            await extractDocument(file.path, { ocr: false, maxCharacters: 20000 }, signal)
          ).slice(0, 4000);
          await verifySource({ source: file.path, stamp: file });
        } catch {
          snippet = '';
        }
      }
      this.store.indexFile({ ...file, id, scopeId: scope.id, snippet, seen, contentRead });
      if (++count % 100 === 0) {
        this.deps.progress({ stage: 'Updating library', count, total: scan.files.length });
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    if (scan.status === 'complete') {
      this.store.finishIndex(scope.id, seen);
      this.store.set(`library-scan:${scope.id}`, '');
    } else
      this.store.set(`library-scan:${scope.id}`, JSON.stringify({ ...scan, inventorySeen: seen }));
    Object.assign(scope, this.store.indexTotals(scope.id), {
      status: scan.status === 'complete' ? 'ready' : 'partial',
      updated: new Date().toISOString(),
      pending: scan.pendingFolders,
      error: undefined,
    });
    this.store.record('scope', scope.id, scope);
    this.deps.changed();
  }
  async libraryState() {
    for (const scope of this.store.records<LibraryScope>('scope')) {
      try {
        await checkPath(scope.root);
        const stat = await fs.lstat(scope.root);
        if (scope.dev !== undefined && (scope.dev !== stat.dev || scope.ino !== stat.ino))
          throw new Error('Library root was replaced.');
        if (scope.status === 'offline') scope.status = scope.pending?.length ? 'partial' : 'ready';
        scope.error = undefined;
      } catch (error) {
        scope.status = 'offline';
        scope.error = (error as Error).message;
      }
      this.store.record('scope', scope.id, scope);
    }
  }
  forgetScope(id: string) {
    const scope = this.store.records<LibraryScope>('scope').find((scope) => scope.id === id);
    if (!scope) throw new Error('Library not found.');
    this.store.db.prepare('DELETE FROM library_files WHERE scope=?').run(id);
    this.store.removeRecord('scope', id);
    this.store.set(`library-scan:${id}`, '');
    for (const collection of this.store
      .records<VirtualCollection>('collection')
      .filter((item) => item.scope === id))
      this.store.removeRecord('collection', collection.id);
    this.deps.changed();
  }
  saveCollection(input: VirtualCollection, remove: boolean) {
    if (
      !input ||
      typeof input.name !== 'string' ||
      !input.name.trim() ||
      input.name.length > 80 ||
      typeof input.query !== 'string' ||
      input.query.length > 200 ||
      typeof input.scope !== 'string' ||
      (input.scope &&
        !this.store.records<LibraryScope>('scope').some((scope) => scope.id === input.scope))
    )
      throw new Error('Choose a name and valid library search.');
    const prior = this.store
      .records<VirtualCollection>('collection')
      .find((item) => item.id === input.id);
    if (remove) {
      if (prior) this.store.removeRecord('collection', prior.id);
    } else {
      if (!prior && this.store.records('collection').length >= 50)
        throw new Error('Remove a saved search before adding more (limit 50).');
      const id = prior?.id || randomUUID();
      this.store.record('collection', id, {
        id,
        name: input.name.trim(),
        query: input.query,
        scope: input.scope,
      });
    }
    this.deps.changed();
  }
  search(query: string, scope: string, offset: number) {
    if (
      typeof query !== 'string' ||
      query.length > 200 ||
      typeof scope !== 'string' ||
      !Number.isInteger(offset) ||
      offset < 0
    )
      throw new Error('Invalid library search.');
    return this.store.searchLibrary(query, scope, offset);
  }
  async openIndexed(id: string, open: (folder: string) => Promise<unknown>) {
    const file = this.store.indexedFile(id);
    if (!file) throw new Error('Library item not found.');
    const scope = this.store
      .records<LibraryScope>('scope')
      .find((scope) => scope.id === file.scopeId);
    if (!scope || !within(scope.root, file.path)) throw new Error('Invalid library item.');
    const identity = await rootIdentity(scope.root);
    if (scope.dev !== undefined && (scope.dev !== identity.dev || scope.ino !== identity.ino))
      throw new Error('Library root was replaced.');
    await this.deps.allowFolder(scope.root);
    await checkPath(file.path);
    return open(path.dirname(file.path));
  }
}
