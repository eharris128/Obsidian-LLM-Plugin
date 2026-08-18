// Mock Obsidian API for testing
export const Platform = {
  isDesktop: true,
  isMobile: false,
  isWin: false,
  isMac: false,
  isLinux: true,
};

export class Plugin {
  app: any;
  manifest: any;
  
  constructor(app: any, manifest: any) {
    this.app = app;
    this.manifest = manifest;
  }

  async loadData(): Promise<any> {
    return Promise.resolve({});
  }

  async saveData(data: any): Promise<void> {
    return Promise.resolve();
  }

  addCommand(command: any): void {}
  addRibbonIcon(icon: string, title: string, callback: any): void {}
  addSettingTab(tab: any): void {}
  registerView(type: string, viewCreator: any): void {}
}

export class WorkspaceLeaf {
  async setViewState(state: any): Promise<void> {
    return Promise.resolve();
  }
}

export const requestUrl = jest.fn().mockResolvedValue({
  json: {},
  text: '',
  arrayBuffer: new ArrayBuffer(0),
  status: 200,
});

export class Editor {
  lastLine(): number { return 0; }
  setCursor(pos: any): void {}
  getCursor(): any { return { line: 0, ch: 0 }; }
  replaceRange(text: string, from: any, to?: any): void {}
}

export const Notice = jest.fn();

export class Modal {
  app: any;
  
  constructor(app: any) {
    this.app = app;
  }
  
  open(): void {}
  close(): void {}
}

export class Setting {
  settingEl: HTMLElement;
  
  constructor(containerEl: HTMLElement) {
    this.settingEl = document.createElement('div');
  }
  
  setName(name: string): this { return this; }
  setDesc(desc: string): this { return this; }
  addText(cb: any): this { cb({}); return this; }
  addDropdown(cb: any): this { cb({}); return this; }
  addButton(cb: any): this { cb({}); return this; }
  addToggle(cb: any): this { cb({}); return this; }
}