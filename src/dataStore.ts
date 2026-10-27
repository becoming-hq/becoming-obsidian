import type { PluginData, SourceEntry, Store } from './settings';

type SyncState = Pick<PluginData, 'sources' | 'deleted' | 'journal' | 'refetch' | 'lastSyncedAt'>;

interface Baseline {
  sources: Record<string, SourceEntry>;
  deleted: Set<number>;
}

// data.json is shared by every device that syncs the vault's config folder.
// When another device changes it, this install's sync state is merged with the
// new copy; everything else (token, device name, settings) is what the disk says.
export class DataStore implements Store {
  private pending: { disk: PluginData; baseline: Baseline } | null = null;

  constructor(
    readonly data: PluginData,
    private readonly write: (data: PluginData) => Promise<void>,
    private readonly idle: () => Promise<void>,
  ) {}

  // While a newer copy waits for a sync to end, its token and settings are what
  // this install writes back, never the ones the run is still using.
  async save(): Promise<void> {
    await this.write(this.pending ? { ...this.pending.disk, ...syncState(this.data) } : this.data);
  }

  // Applied once no sync runs, so a run never switches token or folders midway.
  // False when a newer change arrived meanwhile and applies instead.
  async reload(disk: PluginData): Promise<boolean> {
    const pending = { disk, baseline: this.pending?.baseline ?? baseline(this.data) };
    this.pending = pending;
    await this.idle();
    if (this.pending !== pending) return false;
    this.pending = null;
    Object.assign(this.data, { ...disk, ...merge(this.data, disk, pending.baseline) });
    return true;
  }
}

function syncState({ sources, deleted, journal, refetch, lastSyncedAt }: PluginData): SyncState {
  return { sources, deleted, journal, refetch, lastSyncedAt };
}

function baseline(data: PluginData): Baseline {
  return { sources: structuredClone(data.sources), deleted: new Set(data.deleted) };
}

// What this install changed after the change arrived (a running sync's writes)
// wins; for the rest the disk does. A map entry the disk lacks is kept: the
// writer checks every entry before use. A deletion the disk lacks is dropped:
// that errs toward writing a note again, never toward skipping highlights.
// Journal and refetch only drive idempotent work, so both copies are kept.
function merge(local: PluginData, disk: PluginData, base: Baseline): SyncState {
  const sources = { ...local.sources, ...disk.sources };
  for (const id of new Set([...Object.keys(local.sources), ...Object.keys(base.sources)])) {
    const entry = local.sources[id];
    if (JSON.stringify(entry) === JSON.stringify(base.sources[id])) continue;
    if (entry) sources[id] = entry;
    else delete sources[id];
  }
  const changedHere = (id: number) => local.deleted.includes(id) !== base.deleted.has(id);
  return {
    sources,
    deleted: union(disk.deleted.filter((id) => !changedHere(id)), local.deleted.filter(changedHere)),
    journal: union(local.journal, disk.journal),
    refetch: union(local.refetch, disk.refetch),
    lastSyncedAt: latest(local.lastSyncedAt, disk.lastSyncedAt),
  };
}

function union(a: number[], b: number[]): number[] {
  return [...new Set([...a, ...b])];
}

function latest(a: string | null, b: string | null): string | null {
  return a && b ? (a > b ? a : b) : (a ?? b);
}
