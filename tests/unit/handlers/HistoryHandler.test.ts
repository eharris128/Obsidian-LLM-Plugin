import { History } from '../../../src/History/HistoryHandler';
import { HistoryItem, Message, ChatHistoryItem } from '../../../src/Types/types';
import LLMPlugin from '../../../src/main';

describe('History Handler', () => {
  let history: History;
  let mockPlugin: jest.Mocked<LLMPlugin>;

  beforeEach(() => {
    mockPlugin = {
      settings: {
        promptHistory: [],
      },
      saveSettings: jest.fn(),
    } as any;

    history = new History(mockPlugin);
    jest.clearAllMocks();
  });

  describe('push', () => {
    it('should successfully add a history item to the settings', () => {
      const testHistoryItem: ChatHistoryItem = {
        prompt: 'Test prompt',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
        model: 'gpt-3.5-turbo',
        modelName: 'ChatGPT-3.5',
        temperature: 0.7,
        tokens: 150,
      };

      const result = history.push(testHistoryItem);

      expect(result).toBe(true);
      expect(mockPlugin.settings.promptHistory).toHaveLength(1);
      expect(mockPlugin.settings.promptHistory[0]).toEqual(testHistoryItem);
      expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('should add multiple history items', () => {
      const historyItem1: ChatHistoryItem = {
        prompt: 'First prompt',
        messages: [{ role: 'user', content: 'First message' }],
        model: 'gpt-3.5-turbo',
        modelName: 'ChatGPT-3.5',
        temperature: 0.7,
        tokens: 100,
      };

      const historyItem2: ChatHistoryItem = {
        prompt: 'Second prompt',
        messages: [{ role: 'user', content: 'Second message' }],
        model: 'gpt-4',
        modelName: 'ChatGPT-4',
        temperature: 0.5,
        tokens: 200,
      };

      history.push(historyItem1);
      history.push(historyItem2);

      expect(mockPlugin.settings.promptHistory).toHaveLength(2);
      expect(mockPlugin.settings.promptHistory[0]).toEqual(historyItem1);
      expect(mockPlugin.settings.promptHistory[1]).toEqual(historyItem2);
      expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(2);
    });

    it('should maintain maximum of 10 history items', () => {
      // Add 12 items to test the limit
      for (let i = 0; i < 12; i++) {
        const historyItem: ChatHistoryItem = {
          prompt: `Prompt ${i}`,
          messages: [{ role: 'user', content: `Message ${i}` }],
          model: 'gpt-3.5-turbo',
          modelName: 'ChatGPT-3.5',
          temperature: 0.7,
          tokens: 100,
        };
        history.push(historyItem);
      }

      expect(mockPlugin.settings.promptHistory).toHaveLength(10);
      // Should have removed the first two items (0 and 1)
      expect(mockPlugin.settings.promptHistory[0].prompt).toBe('Prompt 2');
      expect(mockPlugin.settings.promptHistory[9].prompt).toBe('Prompt 11');
    });

    it('should remove oldest item when exceeding 10 items', () => {
      // Pre-populate with 10 items
      for (let i = 0; i < 10; i++) {
        const historyItem: ChatHistoryItem = {
          prompt: `Old Prompt ${i}`,
          messages: [{ role: 'user', content: `Old Message ${i}` }],
          model: 'gpt-3.5-turbo',
          modelName: 'ChatGPT-3.5',
          temperature: 0.7,
          tokens: 100,
        };
        mockPlugin.settings.promptHistory.push(historyItem);
      }

      // Add one more item
      const newItem: ChatHistoryItem = {
        prompt: 'New Prompt',
        messages: [{ role: 'user', content: 'New Message' }],
        model: 'gpt-4',
        modelName: 'ChatGPT-4',
        temperature: 0.8,
        tokens: 150,
      };

      history.push(newItem);

      expect(mockPlugin.settings.promptHistory).toHaveLength(10);
      // First item should be "Old Prompt 1" (Old Prompt 0 was removed)
      expect(mockPlugin.settings.promptHistory[0].prompt).toBe('Old Prompt 1');
      // Last item should be the new item
      expect(mockPlugin.settings.promptHistory[9]).toEqual(newItem);
    });

    it('should return false when an exception occurs', () => {
      // Mock saveSettings to throw an error
      mockPlugin.saveSettings.mockImplementation(() => {
        throw new Error('Save failed');
      });

      const testHistoryItem: ChatHistoryItem = {
        prompt: 'Error prompt',
        messages: [{ role: 'user', content: 'Error message' }],
        model: 'gpt-3.5-turbo',
        modelName: 'ChatGPT-3.5',
        temperature: 0.7,
        tokens: 100,
      };

      const result = history.push(testHistoryItem);

      expect(result).toBe(false);
    });

    it('should handle different types of history items', () => {
      const chatHistoryItem: ChatHistoryItem = {
        prompt: 'Chat prompt',
        messages: [{ role: 'user', content: 'Chat message' }],
        model: 'gpt-3.5-turbo',
        modelName: 'ChatGPT-3.5',
        temperature: 0.7,
        tokens: 100,
      };

      const assistantHistoryItem = {
        prompt: 'Assistant prompt',
        messages: [{ role: 'user', content: 'Assistant message' }],
        model: 'gpt-3.5-turbo',
        assistant_id: 'asst_123',
        modelName: 'Assistant Model',
      };

      history.push(chatHistoryItem);
      history.push(assistantHistoryItem as any);

      expect(mockPlugin.settings.promptHistory).toHaveLength(2);
      expect(mockPlugin.settings.promptHistory[0]).toEqual(chatHistoryItem);
      expect(mockPlugin.settings.promptHistory[1]).toEqual(assistantHistoryItem);
    });
  });

  describe('reset', () => {
    it('should clear all history items', () => {
      // Setup some existing history
      const historyItem1: ChatHistoryItem = {
        prompt: 'First prompt',
        messages: [{ role: 'user', content: 'First message' }],
        model: 'gpt-3.5-turbo',
        modelName: 'ChatGPT-3.5',
        temperature: 0.7,
        tokens: 100,
      };

      const historyItem2: ChatHistoryItem = {
        prompt: 'Second prompt',
        messages: [{ role: 'user', content: 'Second message' }],
        model: 'gpt-4',
        modelName: 'ChatGPT-4',
        temperature: 0.5,
        tokens: 200,
      };

      mockPlugin.settings.promptHistory = [historyItem1, historyItem2];

      history.reset();

      expect(mockPlugin.settings.promptHistory).toEqual([]);
      expect(mockPlugin.settings.promptHistory).toHaveLength(0);
      expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('should work when history is already empty', () => {
      mockPlugin.settings.promptHistory = [];

      history.reset();

      expect(mockPlugin.settings.promptHistory).toEqual([]);
      expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(1);
    });
  });

  describe('overwriteHistory', () => {
    beforeEach(() => {
      // Setup some history items
      const historyItem1: ChatHistoryItem = {
        prompt: 'First prompt',
        messages: [
          { role: 'user', content: 'Original first message' },
          { role: 'assistant', content: 'Original first response' },
        ],
        model: 'gpt-3.5-turbo',
        modelName: 'ChatGPT-3.5',
        temperature: 0.7,
        tokens: 100,
      };

      const historyItem2: ChatHistoryItem = {
        prompt: 'Second prompt',
        messages: [
          { role: 'user', content: 'Original second message' },
        ],
        model: 'gpt-4',
        modelName: 'ChatGPT-4',
        temperature: 0.5,
        tokens: 200,
      };

      mockPlugin.settings.promptHistory = [historyItem1, historyItem2];
    });

    it('should overwrite messages at specified index', () => {
      const newMessages: Message[] = [
        { role: 'user', content: 'Updated message' },
        { role: 'assistant', content: 'Updated response' },
        { role: 'user', content: 'Additional message' },
      ];

      history.overwriteHistory(newMessages, 0);

      expect(mockPlugin.settings.promptHistory[0].messages).toEqual(newMessages);
      expect(mockPlugin.settings.promptHistory[0].prompt).toBe('First prompt'); // Other properties unchanged
      expect(mockPlugin.settings.promptHistory[1].messages).toEqual([
        { role: 'user', content: 'Original second message' },
      ]); // Other history items unchanged
      expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('should overwrite messages at different indices', () => {
      const newMessages: Message[] = [
        { role: 'user', content: 'Updated second message' },
        { role: 'assistant', content: 'Updated second response' },
      ];

      history.overwriteHistory(newMessages, 1);

      expect(mockPlugin.settings.promptHistory[1].messages).toEqual(newMessages);
      expect(mockPlugin.settings.promptHistory[0].messages).toEqual([
        { role: 'user', content: 'Original first message' },
        { role: 'assistant', content: 'Original first response' },
      ]); // First item unchanged
      expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('should handle empty messages array', () => {
      const emptyMessages: Message[] = [];

      history.overwriteHistory(emptyMessages, 0);

      expect(mockPlugin.settings.promptHistory[0].messages).toEqual([]);
      expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('should preserve original history item structure', () => {
      const newMessages: Message[] = [
        { role: 'user', content: 'New message' },
      ];

      const originalItem = { ...mockPlugin.settings.promptHistory[0] };

      history.overwriteHistory(newMessages, 0);

      const updatedItem = mockPlugin.settings.promptHistory[0];
      expect(updatedItem.prompt).toBe(originalItem.prompt);
      expect(updatedItem.model).toBe(originalItem.model);
      expect(updatedItem.modelName).toBe(originalItem.modelName);
      expect(updatedItem.messages).toEqual(newMessages);
    });
  });

  describe('constructor', () => {
    it('should store the plugin reference', () => {
      const newHistory = new History(mockPlugin);
      expect((newHistory as any).plugin).toBe(mockPlugin);
    });
  });
});