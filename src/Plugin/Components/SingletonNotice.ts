import { Notice } from 'obsidian';

export class SingletonNotice {
  private static activeNotice: Notice | null = null;

  static show(message: string, duration: number = 4000) {
    // If there's an active notice, do nothing.
    if (SingletonNotice.activeNotice) return

    // Otherwise show the notice
    SingletonNotice.activeNotice = new Notice(message, duration);

    // Clear the active notice reference after the duration
    activeWindow.setTimeout(() => {
      SingletonNotice.activeNotice = null;
    }, duration);
  }
}