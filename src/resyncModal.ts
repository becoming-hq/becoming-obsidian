import { type App, Modal, Setting } from 'obsidian';

export class ResyncModal extends Modal {
  constructor(
    app: App,
    private readonly onConfirm: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText('Resync everything?');
    this.contentEl.createEl('p', {
      text:
        'Becoming sends every highlight again. Each Becoming note you have not touched is rewritten in place; ' +
        'a note you edited stays as it is and gets a fresh copy next to it.',
    });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText('Resync everything')
          .setWarning()
          .onClick(() => {
            this.close();
            this.onConfirm();
          }),
      );
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
