import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Append, FirstExport, SourceFile } from '../src/api';
import { sha256 } from '../src/crypto';
import { defaultData, type PluginData } from '../src/settings';
import { appendHighlights, Writer } from '../src/writer';
import { FakeVault } from './fakeVault';

const KINDLE_BOOK = readFileSync(new URL('./fixtures/kindle_book.md', import.meta.url), 'utf8');
const PATH = 'Becoming/books/Un Mundo Feliz.md';

function firstExport(markdown = KINDLE_BOOK, overrides: Partial<FirstExport> = {}): FirstExport {
  return { source_id: 42, folder: 'books', file_name: 'Un Mundo Feliz', first_export: true, highlight_ids: [1, 2, 3, 4, 5], markdown, ...overrides };
}

function append(overrides: Partial<Append> = {}): Append {
  return {
    source_id: 42,
    folder: 'books',
    file_name: 'Un Mundo Feliz',
    first_export: false,
    highlight_ids: [6, 7],
    heading: '## New highlights added Oct 13, 2026',
    bullets: '- Sexto subrayado.\n- Séptimo subrayado.\n',
    exported_at: '2026-10-13T09:30:00Z',
    ...overrides,
  };
}

const BUMPED = KINDLE_BOOK.replace('highlights: 5', 'highlights: 7').replace(
  'exported_at: 2026-09-27T14:03:00Z',
  'exported_at: 2026-10-13T09:30:00Z',
);
const APPENDED = `${BUMPED}\n## New highlights added Oct 13, 2026\n\n- Sexto subrayado.\n- Séptimo subrayado.\n`;

describe('Writer', () => {
  let vault: FakeVault;
  let data: PluginData;
  let fetchSource: ReturnType<typeof vi.fn<(id: number) => Promise<SourceFile | null>>>;
  let notify: ReturnType<typeof vi.fn<(message: string) => void>>;
  let writer: Writer;

  beforeEach(() => {
    vault = new FakeVault();
    data = defaultData();
    fetchSource = vi.fn(async () => null);
    notify = vi.fn();
    writer = new Writer(vault, data, { fetchSource, notify });
  });

  describe('first export', () => {
    it('creates the file in nested folders and maps it with its hash', async () => {
      await writer.write(firstExport());

      expect(vault.files.get(PATH)).toBe(KINDLE_BOOK);
      expect(vault.folders).toEqual(new Set(['Becoming', 'Becoming/books']));
      expect(data.sources[42]).toEqual({ path: PATH, hash: await sha256(KINDLE_BOOK) });
    });

    it('puts the file directly in the base folder when grouping is off', async () => {
      data.groupByCategory = false;
      await writer.write(firstExport());

      expect(vault.files.has('Becoming/Un Mundo Feliz.md')).toBe(true);
    });

    it('appends " 2", " 3" on a clash, comparing paths case-insensitively', async () => {
      vault.put('Becoming/books/un mundo feliz.md', 'another note');
      vault.put('Becoming/books/Un Mundo Feliz 2.md', 'yet another');

      await writer.write(firstExport());

      expect(vault.files.get('Becoming/books/Un Mundo Feliz 3.md')).toBe(KINDLE_BOOK);
      expect(vault.files.get('Becoming/books/un mundo feliz.md')).toBe('another note');
      expect(data.sources[42]?.path).toBe('Becoming/books/Un Mundo Feliz 3.md');
    });

    it('overwrites a file the reader has not touched', async () => {
      await writer.write(firstExport());
      const again = KINDLE_BOOK.replace('highlights: 5', 'highlights: 6');

      await writer.write(firstExport(again));

      expect(vault.files.get(PATH)).toBe(again);
      expect(vault.files.size).toBe(1);
      expect(notify).not.toHaveBeenCalled();
    });

    it('leaves an edited file alone and writes a sibling', async () => {
      await writer.write(firstExport());
      vault.files.set(PATH, `${KINDLE_BOOK}\nMy own thoughts.\n`);
      const again = KINDLE_BOOK.replace('highlights: 5', 'highlights: 6');

      await writer.write(firstExport(again));

      expect(vault.files.get(PATH)).toBe(`${KINDLE_BOOK}\nMy own thoughts.\n`);
      expect(vault.files.get('Becoming/books/Un Mundo Feliz 2.md')).toBe(again);
      expect(data.sources[42]).toEqual({ path: 'Becoming/books/Un Mundo Feliz 2.md', hash: await sha256(again) });
      expect(notify).toHaveBeenCalledWith(expect.stringContaining('Becoming/books/Un Mundo Feliz 2.md'));
    });
  });

  describe('append', () => {
    beforeEach(async () => {
      await writer.write(firstExport());
    });

    it('bumps the frontmatter in place and leaves every other byte untouched', async () => {
      await writer.write(append());

      expect(vault.files.get(PATH)).toBe(APPENDED);
      expect(data.sources[42]?.hash).toBe(await sha256(APPENDED));
    });

    it('only bumps the first frontmatter block', async () => {
      const body = '\n---\nhighlights: 3\nexported_at: 2020-01-01T00:00:00Z\n---\n';
      vault.files.set(PATH, KINDLE_BOOK + body);

      await writer.write(append());

      expect(vault.files.get(PATH)).toBe(
        `${BUMPED}${body}\n## New highlights added Oct 13, 2026\n\n- Sexto subrayado.\n- Séptimo subrayado.\n`,
      );
    });

    it('keeps an edited file marked as edited, so a resync never overwrites it', async () => {
      vault.files.set(PATH, `${KINDLE_BOOK}\nMy own thoughts.\n`);

      await writer.write(append());
      await writer.write(firstExport());

      expect(data.sources[42]?.path).toBe('Becoming/books/Un Mundo Feliz 2.md');
      expect(vault.files.get(PATH)).toContain('My own thoughts.');
    });

    it('follows a rename of the file', async () => {
      vault.move(PATH, 'Reading/Brave New World.md');
      writer.renamed(PATH, 'Reading/Brave New World.md');

      await writer.write(append());

      expect(vault.files.get('Reading/Brave New World.md')).toBe(APPENDED);
      expect(data.sources[42]?.path).toBe('Reading/Brave New World.md');
    });

    it('follows a rename of a folder above the file', async () => {
      vault.move(PATH, 'Becoming/Books/Un Mundo Feliz.md');
      writer.renamed('Becoming/books', 'Becoming/Books');

      await writer.write(append());

      expect(vault.files.get('Becoming/Books/Un Mundo Feliz.md')).toBe(APPENDED);
    });

    it('finds a file the map lost by its becoming_url and records it', async () => {
      vault.move(PATH, 'Elsewhere/Huxley.md');
      data.sources = {};

      await writer.write(append());

      expect(vault.files.get('Elsewhere/Huxley.md')).toContain('## New highlights added Oct 13, 2026');
      expect(data.sources[42]?.path).toBe('Elsewhere/Huxley.md');
    });

    it('prefers the file at the expected path when several carry the becoming_url', async () => {
      vault.put('Archive/Copy.md', KINDLE_BOOK);
      data.sources = {};

      await writer.write(append());

      expect(vault.files.get(PATH)).toBe(APPENDED);
      expect(vault.files.get('Archive/Copy.md')).toBe(KINDLE_BOOK);
    });

    it('skips a deleted file when resync is off', async () => {
      vault.files.delete(PATH);
      writer.deleted(PATH);

      await writer.write(append());

      expect(fetchSource).not.toHaveBeenCalled();
      expect(vault.files.size).toBe(0);
      expect(data.refetch).toEqual([]);
    });

    it('fetches the whole file again for a deleted file when resync is on', async () => {
      data.resyncDeleted = true;
      vault.files.delete(PATH);
      writer.deleted(PATH);
      const full = APPENDED;
      fetchSource.mockResolvedValue({ source_id: 42, folder: 'books', file_name: 'Un Mundo Feliz', markdown: full });

      await writer.write(append());

      expect(fetchSource).toHaveBeenCalledWith(42);
      expect(vault.files.get(PATH)).toBe(full);
      expect(data.refetch).toEqual([]);
    });
  });

  describe('refetch queue', () => {
    beforeEach(async () => {
      data.resyncDeleted = true;
      await writer.write(firstExport());
    });

    it('rewrites a deleted file at the next sync', async () => {
      vault.files.delete(PATH);
      writer.deleted(PATH);
      expect(data.refetch).toEqual([42]);
      fetchSource.mockResolvedValue({ source_id: 42, folder: 'books', file_name: 'Un Mundo Feliz', markdown: KINDLE_BOOK });

      await writer.refetchQueued();

      expect(vault.files.get(PATH)).toBe(KINDLE_BOOK);
      expect(data.refetch).toEqual([]);
    });

    it('only re-maps a file that turned up elsewhere', async () => {
      vault.move(PATH, 'Moved/Un Mundo Feliz.md');
      writer.deleted(PATH);

      await writer.refetchQueued();

      expect(fetchSource).not.toHaveBeenCalled();
      expect(data.sources[42]?.path).toBe('Moved/Un Mundo Feliz.md');
      expect(data.refetch).toEqual([]);
    });
  });
});

describe('appendHighlights', () => {
  const heading = '## New highlights added Oct 13, 2026';
  const entry = { heading, bullets: '- b\n', exported_at: 'x', highlight_ids: [1] };

  it.each([
    ['no trailing newline', 'body'],
    ['a trailing newline', 'body\n'],
    ['a trailing blank line', 'body\n\n'],
  ])('leaves exactly one blank line before the heading after %s', (_, content) => {
    expect(appendHighlights(content, entry)).toBe(`body\n\n${heading}\n\n- b\n`);
  });

  it('appends to a file without frontmatter', () => {
    expect(appendHighlights('highlights: 2\n', entry)).toBe(`highlights: 2\n\n${heading}\n\n- b\n`);
  });
});
