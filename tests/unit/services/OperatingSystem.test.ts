import { DesktopOperatingSystem, MobileOperatingSystem } from '../../../src/services/OperatingSystem';

// Mock os module
jest.mock('os', () => ({
  homedir: jest.fn().mockReturnValue('/home/testuser'),
  platform: jest.fn().mockReturnValue('linux'),
}));

describe('OperatingSystem Services', () => {
  describe('DesktopOperatingSystem', () => {
    let os: DesktopOperatingSystem;

    beforeEach(() => {
      os = new DesktopOperatingSystem();
      jest.clearAllMocks();
    });

    describe('homedir', () => {
      it('should return the home directory from os module', () => {
        const osModule = require('os');
        osModule.homedir.mockReturnValue('/home/testuser');

        const result = os.homedir();
        
        expect(result).toBe('/home/testuser');
        expect(osModule.homedir).toHaveBeenCalled();
      });

      it('should handle different home directories', () => {
        const osModule = require('os');
        osModule.homedir.mockReturnValue('/Users/macuser');

        const result = os.homedir();
        
        expect(result).toBe('/Users/macuser');
      });
    });

    describe('platform', () => {
      it('should return the platform from os module', () => {
        const osModule = require('os');
        osModule.platform.mockReturnValue('darwin');

        const result = os.platform();
        
        expect(result).toBe('darwin');
        expect(osModule.platform).toHaveBeenCalled();
      });

      it('should handle different platforms', () => {
        const osModule = require('os');
        
        // Test Windows
        osModule.platform.mockReturnValue('win32');
        expect(os.platform()).toBe('win32');
        
        // Test Linux
        osModule.platform.mockReturnValue('linux');
        expect(os.platform()).toBe('linux');
        
        // Test macOS
        osModule.platform.mockReturnValue('darwin');
        expect(os.platform()).toBe('darwin');
      });
    });
  });

  describe('MobileOperatingSystem', () => {
    let os: MobileOperatingSystem;

    beforeEach(() => {
      os = new MobileOperatingSystem();
    });

    describe('homedir', () => {
      it('should return empty string (not implemented for mobile)', () => {
        const result = os.homedir();
        expect(result).toBe('');
      });
    });

    describe('platform', () => {
      it('should return empty string (not implemented for mobile)', () => {
        const result = os.platform();
        expect(result).toBe('');
      });
    });
  });

  describe('OperatingSystem Interface Compliance', () => {
    it('should ensure DesktopOperatingSystem implements OperatingSystem interface', () => {
      const os = new DesktopOperatingSystem();
      
      expect(typeof os.homedir).toBe('function');
      expect(typeof os.platform).toBe('function');
    });

    it('should ensure MobileOperatingSystem implements OperatingSystem interface', () => {
      const os = new MobileOperatingSystem();
      
      expect(typeof os.homedir).toBe('function');
      expect(typeof os.platform).toBe('function');
    });
  });

  describe('Cross-platform consistency', () => {
    it('should provide consistent interface across desktop and mobile', () => {
      const desktop = new DesktopOperatingSystem();
      const mobile = new MobileOperatingSystem();

      // Both should have the same methods
      expect(typeof desktop.homedir).toBe(typeof mobile.homedir);
      expect(typeof desktop.platform).toBe(typeof mobile.platform);
      
      // Both should return strings
      expect(typeof desktop.homedir()).toBe('string');
      expect(typeof desktop.platform()).toBe('string');
      expect(typeof mobile.homedir()).toBe('string');
      expect(typeof mobile.platform()).toBe('string');
    });
  });
});