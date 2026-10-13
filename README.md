# Becoming for Obsidian

Keeps your [Becoming](https://usebecoming.com) highlights in your vault: one note per book, article,
video or podcast, with your notes and tags, updated as you read. It works on desktop and mobile.

You need a Becoming account with an active plan.

## Install

Until the plugin is listed in Obsidian's community plugins, install it with BRAT:

1. In Obsidian, open **Settings → Community plugins → Browse**, search for **BRAT**, install and
   enable it.
2. Open **Settings → BRAT → Add beta plugin**, enter `becoming-hq/becoming-obsidian` and add it.
3. In **Settings → Community plugins**, enable **Becoming**.

## Connect

1. Open **Settings → Becoming** and click **Connect**. Your browser opens Becoming.
2. Sign in if you need to, check the device name, and approve. Only approve if you just clicked
   Connect in Obsidian.
3. Back in Obsidian the plugin connects within a few seconds and runs its first sync. If ten
   minutes pass without an approval, click Connect again.

Every connection shows up, with its device name, on
[Settings › Exports › Obsidian](https://app.usebecoming.com/settings/exports/obsidian) in Becoming.

## Settings

| Setting | Default | What it does |
|---|---|---|
| Base folder | `Becoming` | Where new notes go. Notes already in your vault stay where they are. |
| Group files in category folders | On | `Becoming/books/Dune.md`, `Becoming/articles/…`, `Becoming/videos/…`, `Becoming/podcasts/…`. Off puts every note directly in the base folder. |
| Sync when Obsidian opens | On | Syncs once your vault has loaded. |
| Sync frequency | Every 12 hours | Manual, every hour, every 12 hours or every 24 hours, while Obsidian is open. |
| Resync deleted files | Off | When you delete a Becoming note, write it again in full at the next sync. |

Commands: **Becoming: Sync now** and **Becoming: Resync everything**. On desktop the status bar shows
when the last sync ran, or that sync is paused or not connected.

## How syncing works

Becoming writes each note once and from then on only adds to it.

- A book, article, video or podcast you have not synced before becomes a new note, in the same
  format as Becoming's Markdown export.
- New highlights on a note you already have are added at the end, under a heading such as
  `## New highlights added Oct 13, 2026`. The `highlights:` count and `exported_at:` date in the
  note's frontmatter are updated in place; nothing else in the note is touched.
- Changes made in Becoming to a highlight that is already in your vault are not synced. Your own
  edits to a note are never overwritten.
- Becoming remembers each highlight it has written, so a sync interrupted by quitting Obsidian picks
  up where it stopped.

### Renames, moves and deletes

- Rename or move a note, or the folder it is in, and new highlights still go to it. The plugin
  follows the rename, and if it ever loses track it finds the note again by its `becoming_url`
  frontmatter, so keep that line.
- Delete a note and Becoming leaves it deleted; its new highlights are skipped. Turn on
  **Resync deleted files** to have deleted notes written again in full at the next sync.

### Resync everything

**Becoming: Resync everything** sends all your highlights again. Each Becoming note you have not
touched since the plugin wrote it is rewritten in place. A note you edited stays as it is, and the
fresh copy is written next to it with a number added (`Dune 2.md`).

## Network use

The plugin talks only to Becoming:

- `api.usebecoming.com`, to fetch your highlights as Markdown and to record which ones it has
  written.
- `app.usebecoming.com`, opened in your browser when you connect, and from the **Manage devices**
  button.

It needs a Becoming account with an active plan. If your plan ends, syncing pauses and every note
already in your vault stays. The plugin sends no analytics of its own. Nothing from your vault
is sent to Becoming except the vault's name, which labels the device when you connect.

## Your token

Connecting stores a token in the plugin's `data.json`, inside your vault's config folder (usually
`.obsidian/plugins/becoming/data.json`), in plain text. It can only read your highlights and
record what was synced; it cannot change anything else in your account. If your vault syncs
through iCloud, Git or another service, the token travels with it.

**Disconnect** in the plugin settings forgets the token on this device. To revoke it, remove the
device on [Settings › Exports › Obsidian](https://app.usebecoming.com/settings/exports/obsidian)
in Becoming. A token unused for 180 days is revoked on its own.

## Development

```sh
npm ci
npm run dev        # rebuilds main.js on change
npm test
npm run typecheck
npm run build      # production main.js
```

Symlink or copy `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/becoming/`. To point the plugin at a local API, set `apiBaseUrl` and
`webBaseUrl` in that folder's `data.json` and reload the plugin; they have no settings UI.

To release, run `npm version <x.y.z>` (it updates `manifest.json` and `versions.json`), then attach
`main.js`, `manifest.json` and `styles.css` to a GitHub release tagged with the same version.

## License

[MIT](LICENSE)
