import type { OrganizerPreset } from '../shared/organizer';
import { needsAI } from '../shared/organizer';

/** Schedules prepare reviews only. The user must apply file changes separately. */
export class MaintenanceQueue {
  private running = false;
  constructor(
    private services: {
      list: () => OrganizerPreset[];
      save: (presets: OrganizerPreset[]) => void;
      available: () => boolean;
      prepare: (preset: OrganizerPreset) => Promise<string>;
      notify: (message: string) => void;
    },
  ) {}
  async pulse(now = Date.now()) {
    if (this.running || !this.services.available()) return;
    const presets = this.services.list();
    const preset = presets.find(
      (p) => p.enabled && !needsAI(p.options.template) && Date.parse(p.nextRun) <= now,
    );
    if (!preset) return;
    this.running = true;
    // Claim this occurrence before work. Restart catches up once, never replays a backlog.
    preset.lastRun = new Date(now).toISOString();
    preset.nextRun = new Date(now + preset.everyHours * 3600000).toISOString();
    preset.error = 'The scheduled review did not finish. Run it again manually if needed.';
    this.services.save(presets);
    try {
      preset.lastPlanId = await this.services.prepare(structuredClone(preset));
      preset.error = undefined;
      this.services.notify(
        `${preset.name}: a new file plan is ready to review. No file changes were applied.`,
      );
    } catch (error) {
      preset.error = (error as Error).message;
      this.services.notify(`${preset.name}: review could not be prepared. ${preset.error}`);
    } finally {
      const latest = this.services.list();
      const current = latest.find((p) => p.id === preset.id);
      if (current)
        Object.assign(current, {
          lastRun: preset.lastRun,
          nextRun: preset.nextRun,
          lastPlanId: preset.lastPlanId,
          error: preset.error,
        });
      try {
        this.services.save(latest);
      } finally {
        this.running = false;
      }
    }
  }
}
