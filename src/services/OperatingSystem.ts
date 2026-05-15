import { Platform } from "obsidian";

export interface OperatingSystem {
    homedir: () => string;
    platform: () => string;
}

export class MobileOperatingSystem implements OperatingSystem {
    homedir() {
        return "";
    }
    platform() {
        return "";
    }
}

export class DesktopOperatingSystem implements OperatingSystem {
    private os: typeof import("os");
    
    constructor() {
        if (!Platform.isDesktop) throw new Error("DesktopOperatingSystem is not available on mobile.");
        this.os = require("os");
    }
    
    homedir() {
        return this.os.homedir();
    }
    
    platform() {
        return this.os.platform();
    }
} 