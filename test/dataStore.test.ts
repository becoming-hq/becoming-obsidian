import { requestUrl, type RequestUrlResponse } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BecomingApi, type PendingPage } from '../src/api';
import { DataStore } from '../src/dataStore';
import { defaultData, type PluginData } from '../src/settings';
import { statusText } from '../src/status';
import { type SyncApi, Syncer } from '../src/sync';

vi.mock('obsidian', async (importOriginal) => ({ ...(await importOriginal<object>()), requestUrl: vi.fn() }));

const EMPTY_PAGE: PendingPage = { has_more: false, sources: [] };

function connected(overrides: Partial<PluginData> = {}): PluginData {
  return { ...defaultData(), token: 'old', deviceName: 'Obsidian · Notes · macOS', ...overrides };
}

function setup(api: SyncApi, data = connected()) {
  const written: PluginData[] = [];
  const holder: { syncer?: Syncer } = {};
  const store = new DataStore(
    data,
    async (saved) => {
      written.push(structuredClone(saved));
    },
    () => holder.syncer?.idle() ?? Promise.resolve(),
  );
  const writer = { write: vi.fn(async () => {}), refetchQueued: vi.fn(async () => {}) };
  const syncer = new Syncer(api, writer, store, { notify: vi.fn(), statusChanged: vi.fn() });
  holder.syncer = syncer;
  return { store, syncer, written, data };
}

function stubApi(): SyncApi & { pending: ReturnType<typeof vi.fn<() => Promise<PendingPage>>> } {
  return { pending: vi.fn(async () => EMPTY_PAGE), ack: vi.fn(async () => {}), reset: vi.fn(async () => {}) };
}

describe('DataStore.reload', () => {
  beforeEach(() => {
    vi.mocked(requestUrl).mockReset();
  });

  it('adopts a token removed elsewhere and never writes the old one back', async () => {
    const { store, data, written } = setup(stubApi());

    expect(await store.reload(connected({ token: null, deviceName: null }))).toBe(true);
    await store.save();

    expect(data.token).toBeNull();
    expect(data.deviceName).toBeNull();
    expect(statusText('idle', Boolean(data.token), data.lastSyncedAt, Date.now())).toBe('Becoming: not connected');
    expect(written.at(-1)?.token).toBeNull();
  });

  it('syncs with a token connected elsewhere', async () => {
    const data = defaultData();
    const api = new BecomingApi(data, 'client-1');
    const { store, syncer } = setup(api, data);
    vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: EMPTY_PAGE } as RequestUrlResponse);

    await store.reload({ ...defaultData(), token: 'new', deviceName: 'Obsidian · Notes · iOS' });
    await syncer.run();

    expect(requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer new' }) }),
    );
  });

  it('waits for a running sync, and meanwhile writes the new token and settings back', async () => {
    const api = stubApi();
    let finish = () => {};
    api.pending.mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve(EMPTY_PAGE))));
    const { store, syncer, data, written } = setup(api);

    const running = syncer.run();
    await vi.waitFor(() => expect(api.pending).toHaveBeenCalled());
    let applied = false;
    const reloading = store.reload(connected({ token: null, baseFolder: 'Elsewhere' })).then((done) => (applied = done));
    await store.save();

    expect(applied).toBe(false);
    expect(data.token).toBe('old');
    expect(data.baseFolder).toBe('Becoming');
    expect(written.at(-1)).toMatchObject({ token: null, baseFolder: 'Elsewhere' });

    finish();
    await running;
    await reloading;

    expect(applied).toBe(true);
    expect(data.token).toBeNull();
    expect(data.baseFolder).toBe('Elsewhere');
  });

  it('applies only the newest of several changes', async () => {
    const { store, data } = setup(stubApi());

    const first = store.reload(connected({ baseFolder: 'First' }));
    const second = store.reload(connected({ baseFolder: 'Second' }));

    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(data.baseFolder).toBe('Second');
  });
});

describe('DataStore merge', () => {
  it('takes the disk entries, keeps entries only this install has, and unions the journal', async () => {
    const local = connected({
      sources: { 1: { path: 'a.md', hash: 'old' }, 2: { path: 'b.md', hash: 'b' } },
      deleted: [5],
      journal: [10],
      refetch: [7],
      lastSyncedAt: '2026-10-27T09:00:00.000Z',
    });
    const { store, data } = setup(stubApi(), local);

    await store.reload(
      connected({
        sources: { 1: { path: 'a.md', hash: 'new' }, 3: { path: 'c.md', hash: 'c' } },
        deleted: [6],
        journal: [11],
        refetch: [8],
        lastSyncedAt: '2026-10-27T10:00:00.000Z',
      }),
    );

    expect(data.sources).toEqual({
      1: { path: 'a.md', hash: 'new' },
      2: { path: 'b.md', hash: 'b' },
      3: { path: 'c.md', hash: 'c' },
    });
    expect(data.deleted).toEqual([6]);
    expect(data.journal).toEqual([10, 11]);
    expect(data.refetch).toEqual([7, 8]);
    expect(data.lastSyncedAt).toBe('2026-10-27T10:00:00.000Z');
  });

  it('keeps what a running sync wrote after the change arrived', async () => {
    const api = stubApi();
    let finish = () => {};
    api.pending.mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve(EMPTY_PAGE))));
    const local = connected({ sources: { 1: { path: 'a.md', hash: 'a1' }, 2: { path: 'b.md', hash: 'b' } }, deleted: [9] });
    const { store, syncer, data } = setup(api, local);

    const running = syncer.run();
    await vi.waitFor(() => expect(api.pending).toHaveBeenCalled());
    const reloading = store.reload(
      connected({ sources: { 1: { path: 'a.md', hash: 'stale' }, 2: { path: 'b.md', hash: 'b' } }, deleted: [9] }),
    );
    data.sources[1] = { path: 'a.md', hash: 'a2' };
    delete data.sources[2];
    data.deleted = [...data.deleted, 2];
    finish();
    await running;
    await reloading;

    expect(data.sources).toEqual({ 1: { path: 'a.md', hash: 'a2' } });
    expect(data.deleted).toEqual([9, 2]);
  });
});
