import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type FirstExport, type PendingPage, type PendingSource } from '../src/api';
import { defaultData, type PluginData, type Store } from '../src/settings';
import { PAUSED_NOTICE, type SyncApi, Syncer, type SourceWriter } from '../src/sync';

function source(id: number, highlightIds: number[]): FirstExport {
  return { source_id: id, folder: 'books', file_name: `Book ${id}`, first_export: true, highlight_ids: highlightIds, markdown: `# ${id}\n` };
}

function setup(pages: PendingPage[] = []) {
  const events: string[] = [];
  const data: PluginData = { ...defaultData(), token: 'secret', deviceName: 'Obsidian · Notes · macOS' };
  const store: Store = {
    data,
    save: vi.fn(async () => {
      events.push(`save ${JSON.stringify(data.journal)}`);
    }),
  };
  const api = {
    pending: vi.fn(async (): Promise<PendingPage> => pages.shift() ?? { has_more: false, sources: [] }),
    ack: vi.fn(async (ids: number[], lastPage: boolean) => {
      events.push(`ack ${JSON.stringify(ids)} ${lastPage}`);
    }),
    reset: vi.fn(async () => {
      events.push('reset');
    }),
  } satisfies SyncApi;
  const writer = {
    write: vi.fn(async (entry: PendingSource) => {
      events.push(`write ${entry.source_id}`);
    }),
    refetchQueued: vi.fn(async () => {}),
  } satisfies SourceWriter;
  const hooks = { notify: vi.fn(), statusChanged: vi.fn() };
  const syncer = new Syncer(api, writer, store, hooks);
  return { events, data, store, api, writer, hooks, syncer };
}

describe('Syncer', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('walks every page, journals after each file and acks each page with last_page', async () => {
    const { syncer, events, data, writer } = setup([
      { has_more: true, sources: [source(1, [10, 11]), source(2, [12])] },
      { has_more: false, sources: [source(3, [13])] },
    ]);

    await syncer.run();

    expect(events).toEqual([
      'write 1',
      'save [10,11]',
      'write 2',
      'save [10,11,12]',
      'ack [10,11,12] false',
      'save []',
      'write 3',
      'save [13]',
      'ack [13] true',
      'save []',
      'save []',
    ]);
    expect(writer.refetchQueued).toHaveBeenCalledOnce();
    expect(data.journal).toEqual([]);
    expect(data.lastSyncedAt).not.toBeNull();
    expect(syncer.status).toBe('idle');
  });

  it('needs no ack for an empty page', async () => {
    const { syncer, api, data } = setup([{ has_more: false, sources: [] }]);

    await syncer.run();

    expect(api.ack).not.toHaveBeenCalled();
    expect(data.lastSyncedAt).not.toBeNull();
  });

  it('acks the journal a quit left behind on the next start', async () => {
    const first = setup([{ has_more: false, sources: [source(1, [10]), source(2, [11])] }]);
    first.writer.write.mockImplementation(async (entry) => {
      if (entry.source_id === 2) throw new Error('Obsidian quit');
    });

    await first.syncer.run();

    expect(first.api.ack).not.toHaveBeenCalled();
    expect(first.data.journal).toEqual([10]);

    const { api, store, writer, hooks } = setup();
    const restarted = new Syncer(api, writer, { ...store, data: first.data }, hooks);
    await restarted.start(false);

    expect(api.ack).toHaveBeenCalledWith([10], false);
    expect(api.pending).not.toHaveBeenCalled();
    expect(first.data.journal).toEqual([]);
  });

  it('acks a leftover journal before asking for the next page', async () => {
    const { syncer, events, data } = setup([{ has_more: false, sources: [source(2, [11])] }]);
    data.journal = [10];

    await syncer.start(true);

    expect(events.slice(0, 3)).toEqual(['ack [10] false', 'save []', 'write 2']);
  });

  it('shows "syncing on another device" on a 409 and keeps the token', async () => {
    const { syncer, api, hooks, data } = setup();
    api.pending.mockRejectedValue(new ApiError(409));

    await syncer.run();

    expect(syncer.status).toBe('busy');
    expect(data.token).toBe('secret');
    expect(hooks.notify).not.toHaveBeenCalled();

    await syncer.run(true);
    expect(hooks.notify).toHaveBeenCalledWith(expect.stringContaining('another device'));
  });

  it('pauses on a 403 and says so once', async () => {
    const { syncer, api, hooks, data } = setup();
    api.pending.mockRejectedValue(new ApiError(403));

    await syncer.run();
    await syncer.run();

    expect(syncer.status).toBe('paused');
    expect(data.token).toBe('secret');
    expect(hooks.notify).toHaveBeenCalledOnce();
    expect(hooks.notify).toHaveBeenCalledWith(PAUSED_NOTICE);
  });

  it('forgets the token on a 401', async () => {
    const { syncer, api, hooks, data, store } = setup();
    api.pending.mockRejectedValue(new ApiError(401));

    await syncer.run();

    expect(data.token).toBeNull();
    expect(data.deviceName).toBeNull();
    expect(store.save).toHaveBeenCalled();
    expect(hooks.notify).toHaveBeenCalledWith(expect.stringContaining('no longer connected'));
  });

  it('runs one sync at a time', async () => {
    const { syncer, api } = setup();
    let release = () => {};
    api.pending.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ has_more: false, sources: [] }))),
    );

    const running = syncer.run();
    await syncer.run();
    release();
    await running;

    expect(api.pending).toHaveBeenCalledOnce();
  });

  it('does nothing without a token', async () => {
    const { syncer, api, data } = setup();
    data.token = null;

    await syncer.run();

    expect(api.pending).not.toHaveBeenCalled();
  });

  it('acks the journal, resets, then syncs on "Resync everything"', async () => {
    const { syncer, events, data } = setup([{ has_more: false, sources: [source(1, [10])] }]);
    data.journal = [9];

    await syncer.resyncEverything();

    expect(events.slice(0, 4)).toEqual(['ack [9] false', 'save []', 'reset', 'write 1']);
  });
});
