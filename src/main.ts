import { Notice, Platform, Plugin } from 'obsidian';
import { BecomingApi, installClientId } from './api';
import { connect, deviceName } from './connect';
import { ObsidianVault, whenCacheReady } from './obsidianVault';
import { ResyncModal } from './resyncModal';
import { BecomingSettingTab, type PluginData, type Store, withDefaults } from './settings';
import { statusText } from './status';
import { Syncer } from './sync';
import { Writer } from './writer';

const CONNECT_FAILURES = {
  expired: 'The Becoming approval expired. Click Connect to try again.',
  rejected: 'Becoming could not start connecting. Try again.',
  timeout: 'No approval arrived within 10 minutes. Click Connect to try again.',
};

export default class BecomingPlugin extends Plugin implements Store {
  data!: PluginData;
  connecting: AbortController | null = null;
  private api!: BecomingApi;
  private writer!: Writer;
  private syncer!: Syncer;
  private settingTab!: BecomingSettingTab;
  private statusBar!: HTMLElement;
  private syncTimer: number | null = null;

  override async onload(): Promise<void> {
    this.data = withDefaults(await this.loadData());
    this.api = new BecomingApi(this.data, installClientId(window.localStorage));
    const writer = new Writer(new ObsidianVault(this.app), this.data, {
      fetchSource: (id) => this.api.source(id),
      notify: (message) => new Notice(message),
    });
    this.writer = writer;
    this.syncer = new Syncer(this.api, writer, this, {
      notify: (message) => new Notice(message),
      statusChanged: () => this.renderStatus(),
    });

    this.settingTab = new BecomingSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.addCommand({ id: 'sync-now', name: 'Sync now', callback: () => void this.syncer.run(true) });
    this.addCommand({
      id: 'resync-everything',
      name: 'Resync everything',
      callback: () => new ResyncModal(this.app, () => void this.syncer.resyncEverything()).open(),
    });

    this.statusBar = this.addStatusBarItem();
    this.registerInterval(window.setInterval(() => this.renderStatus(), 60_000));
    this.renderStatus();

    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (writer.renamed(oldPath, file.path)) void this.save();
      }),
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (writer.deleted(file.path)) void this.save();
      }),
    );

    this.scheduleSync();
    this.app.workspace.onLayoutReady(async () => {
      await whenCacheReady(this.app, (ref) => this.registerEvent(ref));
      await this.syncer.start(this.data.syncOnOpen);
    });
  }

  override onunload(): void {
    this.connecting?.abort();
  }

  async save(): Promise<void> {
    await this.saveData(this.data);
  }

  scheduleSync(): void {
    if (this.syncTimer !== null) window.clearInterval(this.syncTimer);
    this.syncTimer = null;
    const hours = this.data.frequencyHours;
    if (hours > 0) {
      this.syncTimer = this.registerInterval(window.setInterval(() => void this.syncer.run(), hours * 3_600_000));
    }
  }

  async setResyncDeleted(on: boolean): Promise<void> {
    this.data.resyncDeleted = on;
    if (on) this.writer.queueDeleted();
    await this.save();
  }

  manageUrl(): string {
    return `${this.data.webBaseUrl.replace(/\/+$/, '')}/settings/exports/obsidian`;
  }

  async connect(): Promise<void> {
    if (this.connecting) return;
    const controller = new AbortController();
    this.connecting = controller;
    this.settingTab.display();

    const name = deviceName(this.app.vault.getName(), platformName());
    const outcome = await connect(
      { open: (url) => window.open(url), poll: (code) => this.api.exchangeCode(code) },
      this.data.webBaseUrl,
      name,
      controller.signal,
    );
    this.connecting = null;

    if (outcome.kind === 'token') {
      this.data.token = outcome.token;
      this.data.deviceName = name;
      await this.save();
      new Notice('Becoming is connected. Syncing your highlights…');
      void this.syncer.run();
    } else if (outcome.kind !== 'cancelled') {
      new Notice(CONNECT_FAILURES[outcome.kind]);
    }
    this.settingTab.display();
    this.renderStatus();
  }

  cancelConnect(): void {
    this.connecting?.abort();
  }

  async disconnect(): Promise<void> {
    this.data.token = null;
    this.data.deviceName = null;
    await this.save();
    this.settingTab.display();
    this.renderStatus();
  }

  private renderStatus(): void {
    this.statusBar.setText(statusText(this.syncer.status, Boolean(this.data.token), this.data.lastSyncedAt, Date.now()));
  }
}

function platformName(): string {
  if (Platform.isIosApp) return 'iOS';
  if (Platform.isAndroidApp) return 'Android';
  if (Platform.isMacOS) return 'macOS';
  if (Platform.isWin) return 'Windows';
  if (Platform.isLinux) return 'Linux';
  return 'Desktop';
}
