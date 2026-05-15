import { Platform } from "obsidian";
import LLMPlugin from "main";

export interface FileSystem {
    existsSync: (path: string) => boolean;
    createReadStream: (path: string) => Promise<ReadableStream>;
}

export class DesktopFileSystem implements FileSystem {
    private fs: typeof import('fs');

    constructor() {
        if (!Platform.isDesktop) throw new Error("DesktopFileSystem is not available on mobile.");
        this.fs = require('fs');
    }

    existsSync(path: string) {
        return this.fs.existsSync(path);
    }

    async createReadStream(path: string): Promise<ReadableStream> {
        return new Promise((resolve) => {
            const nodeStream = this.fs.createReadStream(path);
            resolve(new ReadableStream({
                start(controller) {
                    nodeStream.on('data', (chunk) => controller.enqueue(chunk));
                    nodeStream.on('end', () => controller.close());
                    nodeStream.on('error', (err) => controller.error(err));
                }
            }));
        });
    }
}

export class MobileFileSystem implements FileSystem {
    private plugin: LLMPlugin;

    constructor(plugin: LLMPlugin) {
        this.plugin = plugin;
    }

    existsSync(path: string) {
        return false;
    }

    async createReadStream(path: string): Promise<ReadableStream> {
        const buffer = await this.plugin.app.vault.adapter.readBinary(path);
        return new ReadableStream({
            start(controller) {
                controller.enqueue(buffer);
                controller.close();
            }
        });
    }
} 