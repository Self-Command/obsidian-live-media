import {Plugin, Notice} from 'obsidian';
import {OfflineEngine} from './engine/client';
export default class LiveMedia extends Plugin {
  engine = new OfflineEngine();
  override onload(): void {
    this.addCommand({id: 'offline-engine-check', name: 'Check offline engine', callback: () => {
      void this.engine.load().then(() => new Notice('Offline engines loaded')).catch(e => new Notice(String(e)));
    }});
  }
  override onunload(): void {this.engine.destroy();}
}
