import LLMPlugin, { LLMPluginSettings, DEFAULT_SETTINGS } from '../../../src/main';
import { testPluginSettings } from '../../fixtures/test-data';
import { Platform } from 'obsidian';

// Mock external dependencies
jest.mock('obsidian');
jest.mock('../../../src/services/FileSystem');
jest.mock('../../../src/services/OperatingSystem');
jest.mock('../../../src/Assistants/AssistantHandler');
jest.mock('../../../src/History/HistoryHandler');
jest.mock('../../../src/Plugin/FAB/FAB');
jest.mock('../../../src/Plugin/Components/MessageStore');

describe('LLMPlugin Integration Tests', () => {
  let plugin: LLMPlugin;
  let mockApp: any;
  let mockManifest: any;

  beforeEach(() => {
    // Mock Obsidian app
    mockApp = {
      vault: {
        adapter: {
          readBinary: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
        },
      },
      workspace: {
        getLeavesOfType: jest.fn().mockReturnValue([]),
        getLeaf: jest.fn().mockReturnValue({
          setViewState: jest.fn().mockResolvedValue(undefined),
        }),
        revealLeaf: jest.fn(),
      },
    };

    mockManifest = {
      id: 'large-language-models',
      name: 'Large Language Models',
      version: '0.19.18',
    };

    plugin = new LLMPlugin(mockApp, mockManifest);
    jest.clearAllMocks();
  });

  describe('Plugin Lifecycle', () => {
    it('should initialize with default settings', async () => {
      // Mock loadData to return null (first time setup)
      jest.spyOn(plugin, 'loadData').mockResolvedValue(null);
      jest.spyOn(plugin, 'saveData').mockResolvedValue();

      await plugin.onload();

      expect(plugin.settings).toEqual(expect.objectContaining({
        currentIndex: -1,
        promptHistory: [],
        assistants: [],
        openAIAPIKey: '',
        claudeAPIKey: '',
        geminiAPIKey: '',
        showFAB: false,
      }));
    });

    it('should load existing settings from data.json', async () => {
      const existingSettings: Partial<LLMPluginSettings> = {
        openAIAPIKey: 'existing-key',
        showFAB: true,
        promptHistory: [testPluginSettings.promptHistory[0]],
      };

      jest.spyOn(plugin, 'loadData').mockResolvedValue(existingSettings);
      jest.spyOn(plugin, 'saveData').mockResolvedValue();

      await plugin.onload();

      expect(plugin.settings.openAIAPIKey).toBe('existing-key');
      expect(plugin.settings.showFAB).toBe(true);
      expect(plugin.settings.promptHistory).toHaveLength(1);
    });

    it('should initialize services based on platform', async () => {
      jest.spyOn(plugin, 'loadData').mockResolvedValue(null);
      jest.spyOn(plugin, 'saveData').mockResolvedValue();

      // Mock Platform.isDesktop
      (Platform as any).isDesktop = true;

      await plugin.onload();

      expect(plugin.fileSystem).toBeDefined();
      expect(plugin.os).toBeDefined();
      expect(plugin.messageStore).toBeDefined();
      expect(plugin.fab).toBeDefined();
      expect(plugin.history).toBeDefined();
      expect(plugin.assistants).toBeDefined();
    });

    it('should handle mobile platform initialization', async () => {
      jest.spyOn(plugin, 'loadData').mockResolvedValue(null);
      jest.spyOn(plugin, 'saveData').mockResolvedValue();

      // Mock Platform.isDesktop
      (Platform as any).isDesktop = false;

      await plugin.onload();

      expect(plugin.fileSystem).toBeDefined();
      expect(plugin.os).toBeDefined();
    });

    it('should cleanup on unload', () => {
      // Setup plugin state
      plugin.fab = {
        removeFab: jest.fn(),
      } as any;

      plugin.onunload();

      expect(plugin.fab.removeFab).toHaveBeenCalled();
    });
  });

  describe('Settings Management', () => {
    beforeEach(async () => {
      jest.spyOn(plugin, 'loadData').mockResolvedValue(null);
      jest.spyOn(plugin, 'saveData').mockResolvedValue();
      await plugin.onload();
    });

    it('should save settings correctly', async () => {
      const saveSpy = jest.spyOn(plugin, 'saveData').mockResolvedValue();

      plugin.settings.openAIAPIKey = 'new-api-key';
      await plugin.saveSettings();

      expect(saveSpy).toHaveBeenCalledWith(plugin.settings);
    });

    it('should reset history indices on load', async () => {
      const settingsWithHistory = {
        ...testPluginSettings,
        fabSettings: { ...testPluginSettings.fabSettings, historyIndex: 5 },
        widgetSettings: { ...testPluginSettings.widgetSettings, historyIndex: 3 },
      };

      jest.spyOn(plugin, 'loadData').mockResolvedValue(settingsWithHistory);

      await plugin.loadSettings();

      expect(plugin.settings.fabSettings.historyIndex).toBe(-1);
      expect(plugin.settings.widgetSettings.historyIndex).toBe(-1);
    });
  });

  describe('Command Registration', () => {
    beforeEach(async () => {
      jest.spyOn(plugin, 'loadData').mockResolvedValue(null);
      jest.spyOn(plugin, 'saveData').mockResolvedValue();
      plugin.addCommand = jest.fn();
      plugin.addRibbonIcon = jest.fn();
      plugin.addSettingTab = jest.fn();
      plugin.registerView = jest.fn();
    });

    it('should register all commands during onload', async () => {
      await plugin.onload();

      expect(plugin.addCommand).toHaveBeenCalledTimes(3);
      expect(plugin.addCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'open-llm-modal',
          name: 'Open modal',
        })
      );
      expect(plugin.addCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'open-LLM-widget-tab',
          name: 'Open chat in tab',
        })
      );
      expect(plugin.addCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'toggle-LLM-fab',
          name: 'Toggle FAB',
        })
      );
    });

    it('should register ribbon icon', async () => {
      await plugin.onload();

      expect(plugin.addRibbonIcon).toHaveBeenCalledWith(
        'bot',
        'Ask a question',
        expect.any(Function)
      );
    });

    it('should register view and setting tab', async () => {
      await plugin.onload();

      expect(plugin.registerView).toHaveBeenCalled();
      expect(plugin.addSettingTab).toHaveBeenCalled();
    });
  });

  describe('Tab Management', () => {
    beforeEach(async () => {
      jest.spyOn(plugin, 'loadData').mockResolvedValue(null);
      jest.spyOn(plugin, 'saveData').mockResolvedValue();
      await plugin.onload();
    });

    it('should activate existing tab if available', async () => {
      const mockLeaf = {
        setViewState: jest.fn().mockResolvedValue(undefined),
      };
      mockApp.workspace.getLeavesOfType.mockReturnValue([mockLeaf]);

      await plugin.activateTab();

      expect(mockApp.workspace.getLeavesOfType).toHaveBeenCalled();
      expect(mockApp.workspace.revealLeaf).toHaveBeenCalledWith(mockLeaf);
    });

    it('should create new tab if none exists', async () => {
      const mockNewLeaf = {
        setViewState: jest.fn().mockResolvedValue(undefined),
      };
      mockApp.workspace.getLeavesOfType.mockReturnValue([]);
      mockApp.workspace.getLeaf.mockReturnValue(mockNewLeaf);

      await plugin.activateTab();

      expect(mockApp.workspace.getLeaf).toHaveBeenCalledWith('tab');
      expect(mockNewLeaf.setViewState).toHaveBeenCalled();
      expect(mockApp.workspace.revealLeaf).toHaveBeenCalledWith(mockNewLeaf);
    });
  });

  describe('API Key Validation', () => {
    beforeEach(async () => {
      jest.spyOn(plugin, 'loadData').mockResolvedValue(null);
      jest.spyOn(plugin, 'saveData').mockResolvedValue();
      await plugin.onload();
    });

    it('should validate API keys when models require them', async () => {
      plugin.settings.modalSettings.model = 'gpt-3.5-turbo';
      plugin.settings.openAIAPIKey = 'sk-test-key';

      // Mock the validation method
      plugin.validateActiveModelsAPIKeys = jest.fn().mockResolvedValue(undefined);

      await plugin.checkForAPIKeyBasedModel();

      expect(plugin.validateActiveModelsAPIKeys).toHaveBeenCalled();
    });

    it('should skip validation when no API keys are required', async () => {
      plugin.settings.modalSettings.model = 'local-model';
      plugin.settings.widgetSettings.model = 'local-model';
      plugin.settings.fabSettings.model = 'local-model';

      plugin.validateActiveModelsAPIKeys = jest.fn();

      await plugin.checkForAPIKeyBasedModel();

      expect(plugin.validateActiveModelsAPIKeys).not.toHaveBeenCalled();
    });
  });

  describe('Settings Persistence', () => {
    it('should handle loadSettings with existing data', async () => {
      const mockData = { openAIAPIKey: 'test-key' };
      jest.spyOn(plugin, 'loadData').mockResolvedValue(mockData);

      await plugin.loadSettings();

      expect(plugin.settings.openAIAPIKey).toBe('test-key');
    });

    it('should use default settings when no data exists', async () => {
      jest.spyOn(plugin, 'loadData').mockResolvedValue(null);

      await plugin.loadSettings();

      expect(plugin.settings).toEqual(expect.objectContaining(DEFAULT_SETTINGS));
    });
  });
});