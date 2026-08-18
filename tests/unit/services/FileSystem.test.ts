import { DesktopFileSystem, MobileFileSystem } from '../../../src/services/FileSystem';
import LLMPlugin from '../../../src/main';

// Mock fs module
jest.mock('fs', () => require('../../__mocks__/fs'));

describe('FileSystem Services', () => {
  describe('DesktopFileSystem', () => {
    let fileSystem: DesktopFileSystem;

    beforeEach(() => {
      fileSystem = new DesktopFileSystem();
      jest.clearAllMocks();
    });

    describe('existsSync', () => {
      it('should return true when file exists', () => {
        const fs = require('fs');
        fs.existsSync.mockReturnValue(true);

        const result = fileSystem.existsSync('/path/to/file.txt');
        expect(result).toBe(true);
        expect(fs.existsSync).toHaveBeenCalledWith('/path/to/file.txt');
      });

      it('should return false when file does not exist', () => {
        const fs = require('fs');
        fs.existsSync.mockReturnValue(false);

        const result = fileSystem.existsSync('/path/to/nonexistent.txt');
        expect(result).toBe(false);
        expect(fs.existsSync).toHaveBeenCalledWith('/path/to/nonexistent.txt');
      });
    });

    describe('createReadStream', () => {
      it('should create a readable stream from file', async () => {
        const fs = require('fs');
        const mockNodeStream = {
          on: jest.fn((event, callback) => {
            if (event === 'data') {
              setTimeout(() => callback(Buffer.from('test data')), 0);
            } else if (event === 'end') {
              setTimeout(() => callback(), 10);
            }
          }),
        };
        fs.createReadStream.mockReturnValue(mockNodeStream);

        const stream = await fileSystem.createReadStream('/path/to/file.txt');
        expect(stream).toBeInstanceOf(ReadableStream);
        expect(fs.createReadStream).toHaveBeenCalledWith('/path/to/file.txt');
      });

      it('should handle stream errors', async () => {
        const fs = require('fs');
        const mockNodeStream = {
          on: jest.fn((event, callback) => {
            if (event === 'error') {
              setTimeout(() => callback(new Error('File read error')), 0);
            }
          }),
        };
        fs.createReadStream.mockReturnValue(mockNodeStream);

        const stream = await fileSystem.createReadStream('/path/to/error.txt');
        expect(stream).toBeInstanceOf(ReadableStream);
      });
    });
  });

  describe('MobileFileSystem', () => {
    let fileSystem: MobileFileSystem;
    let mockPlugin: jest.Mocked<LLMPlugin>;

    beforeEach(() => {
      mockPlugin = {
        app: {
          vault: {
            adapter: {
              readBinary: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
            },
          },
        },
      } as any;

      fileSystem = new MobileFileSystem(mockPlugin);
      jest.clearAllMocks();
    });

    describe('existsSync', () => {
      it('should always return false (not implemented for mobile)', () => {
        const result = fileSystem.existsSync('/any/path');
        expect(result).toBe(false);
      });
    });

    describe('createReadStream', () => {
      it('should create a readable stream from vault adapter', async () => {
        const testBuffer = new ArrayBuffer(16);
        mockPlugin.app.vault.adapter.readBinary.mockResolvedValue(testBuffer);

        const stream = await fileSystem.createReadStream('/vault/path/file.txt');
        
        expect(stream).toBeInstanceOf(ReadableStream);
        expect(mockPlugin.app.vault.adapter.readBinary).toHaveBeenCalledWith('/vault/path/file.txt');
      });

      it('should handle binary read errors', async () => {
        mockPlugin.app.vault.adapter.readBinary.mockRejectedValue(new Error('Vault read error'));

        await expect(fileSystem.createReadStream('/vault/path/nonexistent.txt'))
          .rejects.toThrow('Vault read error');
      });

      it('should create stream that enqueues buffer and closes', async () => {
        const testBuffer = new ArrayBuffer(8);
        mockPlugin.app.vault.adapter.readBinary.mockResolvedValue(testBuffer);

        const stream = await fileSystem.createReadStream('/vault/path/file.txt');
        
        // Test that we can get a reader from the stream
        const reader = stream.getReader();
        expect(reader).toBeDefined();
        
        // The stream should provide the buffer data
        const result = await reader.read();
        expect(result.value).toBe(testBuffer);
        
        // The next read should indicate the stream is done
        const endResult = await reader.read();
        expect(endResult.done).toBe(true);
      });
    });
  });

  describe('FileSystem Interface Compliance', () => {
    it('should ensure DesktopFileSystem implements FileSystem interface', () => {
      const fileSystem = new DesktopFileSystem();
      
      expect(typeof fileSystem.existsSync).toBe('function');
      expect(typeof fileSystem.createReadStream).toBe('function');
    });

    it('should ensure MobileFileSystem implements FileSystem interface', () => {
      const mockPlugin = {} as LLMPlugin;
      const fileSystem = new MobileFileSystem(mockPlugin);
      
      expect(typeof fileSystem.existsSync).toBe('function');
      expect(typeof fileSystem.createReadStream).toBe('function');
    });
  });
});