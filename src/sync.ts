import { ApiError, type PendingPage, type PendingSource } from './api';
import type { Store } from './settings';
import type { Status } from './status';

export interface SyncApi {
  pending(): Promise<PendingPage>;
  ack(ids: number[], lastPage: boolean): Promise<void>;
  reset(): Promise<void>;
}

export interface SourceWriter {
  write(source: PendingSource): Promise<void>;
  refetchQueued(): Promise<void>;
}

export interface SyncHooks {
  notify(message: string): void;
  statusChanged(): void;
}

export const PAUSED_NOTICE = 'Sync paused — your Becoming plan ended. Your files stay in your vault.';
export const OPEN_DELAY_MS = 30_000;

export class Syncer {
  status: Status = 'idle';
  private running = false;
  private stopped = false;
  private current: Promise<void> = Promise.resolve();

  constructor(
    private readonly api: SyncApi,
    private readonly writer: SourceWriter,
    private readonly store: Store,
    private readonly hooks: SyncHooks,
  ) {}

  async start(syncOnOpen: boolean): Promise<void> {
    if (syncOnOpen) {
      // Gives Obsidian Sync or iCloud time to bring this device's notes down first.
      await new Promise((resolve) => window.setTimeout(resolve, OPEN_DELAY_MS));
      return this.run();
    }
    if (this.store.data.journal.length === 0) return;
    return this.guard(false, async () => {
      await this.ackJournal(false);
      return 0;
    });
  }

  stop(): void {
    this.stopped = true;
  }

  // Resolves when no sync is running.
  idle(): Promise<void> {
    return this.current;
  }

  run(manual = false): Promise<void> {
    return this.guard(manual, () => this.sync());
  }

  // The journal is acknowledged before the reset, or its highlights would come
  // back as appends instead of inside the full files.
  resyncEverything(): Promise<void> {
    return this.guard(true, async () => {
      await this.ackJournal(false);
      await this.api.reset();
      return this.sync();
    });
  }

  private async sync(): Promise<number> {
    await this.ackJournal(false);
    let count = 0;
    let page: PendingPage;
    do {
      page = await this.api.pending();
      for (const source of page.sources) {
        await this.writer.write(source);
        // Journaled after the write: a quit costs one duplicated source, never a lost one.
        this.store.data.journal.push(...source.highlight_ids);
        await this.store.save();
        count += source.highlight_ids.length;
      }
      await this.ackJournal(!page.has_more);
    } while (page.has_more && page.sources.length > 0);
    await this.writer.refetchQueued();
    return count;
  }

  private async ackJournal(lastPage: boolean): Promise<void> {
    const { journal } = this.store.data;
    if (journal.length === 0) return;
    await this.api.ack(journal, lastPage);
    this.store.data.journal = [];
    await this.store.save();
  }

  private guard(manual: boolean, work: () => Promise<number>): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) {
      if (manual) this.hooks.notify('Becoming is already syncing.');
      return Promise.resolve();
    }
    if (!this.store.data.token) {
      if (manual) this.hooks.notify('Connect Becoming in the plugin settings first.');
      return Promise.resolve();
    }
    this.running = true;
    this.current = this.execute(manual, work).catch((error: unknown) => console.error('Becoming sync failed', error));
    return this.current;
  }

  private async execute(manual: boolean, work: () => Promise<number>): Promise<void> {
    const before = this.status;
    this.setStatus('syncing');
    try {
      const count = await work();
      this.store.data.lastSyncedAt = new Date().toISOString();
      await this.store.save();
      this.setStatus('idle');
      if (manual) this.hooks.notify(count > 0 ? `Becoming synced ${count} new highlight${count === 1 ? '' : 's'}.` : 'Becoming: nothing new to sync.');
    } catch (error) {
      await this.fail(error, manual, before);
    } finally {
      this.running = false;
    }
  }

  private async fail(error: unknown, manual: boolean, before: Status): Promise<void> {
    const kind = error instanceof ApiError ? error.kind : 'failed';
    if (kind === 'unauthorized') {
      this.store.data.token = null;
      this.store.data.deviceName = null;
      await this.store.save();
      this.setStatus('idle');
      this.hooks.notify('This device is no longer connected to Becoming. Connect again in the plugin settings.');
    } else if (kind === 'paused') {
      this.setStatus('paused');
      if (manual || before !== 'paused') this.hooks.notify(PAUSED_NOTICE);
    } else if (kind === 'busy') {
      this.setStatus('busy');
      if (manual) this.hooks.notify('Becoming is syncing on another device. Try again in a minute.');
    } else {
      console.error('Becoming sync failed', error);
      this.setStatus('failed');
      if (manual) this.hooks.notify('Becoming sync failed. Check your connection and try again.');
    }
  }

  private setStatus(status: Status): void {
    this.status = status;
    this.hooks.statusChanged();
  }
}
