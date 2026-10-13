import { type App, normalizePath, PluginSettingTab, Setting } from 'obsidian';
import type BecomingPlugin from './main';

export interface SourceEntry {
  path: string;
  // SHA-256 of the file as the plugin last wrote it; null when it may hold the reader's edits.
  hash: string | null;
}

export interface PluginData {
  apiBaseUrl: string;
  webBaseUrl: string;
  token: string | null;
  deviceName: string | null;
  baseFolder: string;
  groupByCategory: boolean;
  syncOnOpen: boolean;
  frequencyHours: number;
  resyncDeleted: boolean;
  lastSyncedAt: string | null;
  sources: Record<string, SourceEntry>;
  journal: number[];
  refetch: number[];
  // Sources whose note was deleted in this vault, here or synced in from another device.
  deleted: number[];
}

export interface Store {
  data: PluginData;
  save(): Promise<void>;
}

export const DEFAULT_BASE_FOLDER = 'Becoming';

const FREQUENCIES: Record<string, string> = {
  '0': 'Manual',
  '1': 'Every hour',
  '12': 'Every 12 hours',
  '24': 'Every 24 hours',
};

export function defaultData(): PluginData {
  return {
    apiBaseUrl: 'https://api.usebecoming.com',
    webBaseUrl: 'https://app.usebecoming.com',
    token: null,
    deviceName: null,
    baseFolder: DEFAULT_BASE_FOLDER,
    groupByCategory: true,
    syncOnOpen: true,
    frequencyHours: 12,
    resyncDeleted: false,
    lastSyncedAt: null,
    sources: {},
    journal: [],
    refetch: [],
    deleted: [],
  };
}

export function withDefaults(saved: Partial<PluginData> | null): PluginData {
  return { ...defaultData(), ...saved };
}

export class BecomingSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: BecomingPlugin,
  ) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    const { data } = this.plugin;
    containerEl.empty();
    this.connection(containerEl);

    new Setting(containerEl)
      .setName('Base folder')
      .setDesc('Where new notes go. Notes already in your vault stay where they are.')
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_BASE_FOLDER)
          .setValue(data.baseFolder)
          .onChange(async (value) => {
            data.baseFolder = value.trim() ? normalizePath(value) : DEFAULT_BASE_FOLDER;
            await this.plugin.save();
          }),
      );

    new Setting(containerEl)
      .setName('Group files in category folders')
      .setDesc('Books, articles, videos and podcasts each get a folder. Off puts every note in the base folder.')
      .addToggle((toggle) =>
        toggle.setValue(data.groupByCategory).onChange(async (value) => {
          data.groupByCategory = value;
          await this.plugin.save();
        }),
      );

    new Setting(containerEl)
      .setName('Sync when Obsidian opens')
      .setDesc('Starts 30 seconds after the vault loads, so Obsidian Sync or iCloud can bring your notes down first.')
      .addToggle((toggle) =>
        toggle.setValue(data.syncOnOpen).onChange(async (value) => {
          data.syncOnOpen = value;
          await this.plugin.save();
        }),
      );

    new Setting(containerEl).setName('Sync frequency').addDropdown((dropdown) =>
      dropdown
        .addOptions(FREQUENCIES)
        .setValue(String(data.frequencyHours))
        .onChange(async (value) => {
          data.frequencyHours = Number(value);
          await this.plugin.save();
          this.plugin.scheduleSync();
        }),
    );

    new Setting(containerEl)
      .setName('Resync deleted files')
      .setDesc('Write deleted Becoming notes again in full at the next sync, including ones deleted before you turned this on.')
      .addToggle((toggle) =>
        toggle.setValue(data.resyncDeleted).onChange((value) => this.plugin.setResyncDeleted(value)),
      );
  }

  private connection(containerEl: HTMLElement): void {
    const { data } = this.plugin;
    const setting = new Setting(containerEl);

    if (data.token) {
      setting
        .setName('Connected')
        .setDesc(
          `This vault syncs as “${data.deviceName ?? 'this device'}”. Disconnect forgets the token here; ` +
            'to revoke it, remove the device on the Manage devices page.',
        )
        .addButton((button) =>
          button.setButtonText('Manage devices').onClick(() => window.open(this.plugin.manageUrl())),
        )
        .addButton((button) =>
          button.setButtonText('Disconnect').onClick(async () => {
            await this.plugin.disconnect();
          }),
        );
    } else if (this.plugin.connecting) {
      setting
        .setName('Connect')
        .setDesc('Waiting for approval in your browser…')
        .addButton((button) => button.setButtonText('Cancel').onClick(() => this.plugin.cancelConnect()));
    } else {
      setting
        .setName('Connect')
        .setDesc('Approve this vault in your browser while signed in to Becoming. Needs an active Becoming plan.')
        .addButton((button) =>
          button
            .setButtonText('Connect')
            .setCta()
            .onClick(() => void this.plugin.connect()),
        );
    }
  }
}
