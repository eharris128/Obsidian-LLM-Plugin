import {
  upperCaseFirst,
  getApiKeyValidity,
  processReplacementTokens,
  getViewInfo,
  changeDefaultModel,
  setHistoryIndex,
  getSettingType,
  getAssistant,
} from '../../../src/utils/utils';
import { ViewType, ProviderKeyPair } from '../../../src/Types/types';
import { openAI, claude, gemini } from '../../../src/utils/constants';
import LLMPlugin from '../../../src/main';

// Mock external dependencies
jest.mock('../../../src/utils/utils', () => ({
  ...jest.requireActual('../../../src/utils/utils'),
}));

jest.mock('openai');
jest.mock('@anthropic-ai/sdk');
jest.mock('@google/generative-ai');

describe('Utils Functions', () => {
  describe('upperCaseFirst', () => {
    it('should capitalize the first character of a string', () => {
      expect(upperCaseFirst('hello')).toBe('Hello');
      expect(upperCaseFirst('world')).toBe('World');
      expect(upperCaseFirst('test123')).toBe('Test123');
    });

    it('should handle empty string', () => {
      expect(upperCaseFirst('')).toBe('');
    });

    it('should handle single character', () => {
      expect(upperCaseFirst('a')).toBe('A');
      expect(upperCaseFirst('Z')).toBe('Z');
    });

    it('should not affect already capitalized strings', () => {
      expect(upperCaseFirst('Hello')).toBe('Hello');
      expect(upperCaseFirst('WORLD')).toBe('WORLD');
    });
  });

  describe('getApiKeyValidity', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return valid true for valid OpenAI API key', async () => {
      const mockOpenAI = require('openai');
      mockOpenAI.mockImplementation(() => ({
        models: {
          list: jest.fn().mockResolvedValue({ data: [] }),
        },
      }));

      const providerKeyPair: ProviderKeyPair = {
        provider: openAI,
        key: 'valid-openai-key',
      };

      const result = await getApiKeyValidity(providerKeyPair);
      expect(result).toEqual({ provider: openAI, valid: true });
    });

    it('should return false for invalid API key', async () => {
      const mockOpenAI = require('openai');
      mockOpenAI.mockImplementation(() => ({
        models: {
          list: jest.fn().mockRejectedValue({ status: 401 }),
        },
      }));

      const providerKeyPair: ProviderKeyPair = {
        provider: openAI,
        key: 'invalid-key',
      };

      const result = await getApiKeyValidity(providerKeyPair);
      expect(result).toBe(false);
    });

    it('should handle Claude provider validation', async () => {
      const mockAnthropic = require('@anthropic-ai/sdk');
      mockAnthropic.mockImplementation(() => ({
        messages: {
          create: jest.fn().mockResolvedValue({}),
        },
      }));

      const providerKeyPair: ProviderKeyPair = {
        provider: claude,
        key: 'valid-claude-key',
      };

      const result = await getApiKeyValidity(providerKeyPair);
      expect(result).toEqual({ provider: claude, valid: true });
    });

    it('should handle Gemini provider validation', async () => {
      const mockGoogleAI = require('@google/generative-ai');
      mockGoogleAI.GoogleGenerativeAI.mockImplementation(() => ({
        getGenerativeModel: () => ({
          generateContent: jest.fn().mockResolvedValue({}),
        }),
      }));

      const providerKeyPair: ProviderKeyPair = {
        provider: gemini,
        key: 'valid-gemini-key',
      };

      const result = await getApiKeyValidity(providerKeyPair);
      expect(result).toEqual({ provider: gemini, valid: true });
    });
  });

  describe('processReplacementTokens', () => {
    it('should process replacement tokens correctly', () => {
      // This function uses 'this.replacementTokens' which suggests it should be a method
      // For now, test the basic functionality
      const prompt = 'Hello {{name}}, how are you?';
      
      // Mock the context with replacementTokens
      const context = {
        replacementTokens: {
          name: (match: any, prompt: string) => prompt.replace(match[0], 'World'),
        },
      };

      const result = processReplacementTokens.call(context, prompt);
      expect(result).toBe('Hello World, how are you?');
    });

    it('should return original prompt if no tokens found', () => {
      const prompt = 'Hello World, how are you?';
      const context = { replacementTokens: {} };
      
      const result = processReplacementTokens.call(context, prompt);
      expect(result).toBe(prompt);
    });
  });

  describe('getViewInfo', () => {
    let mockPlugin: jest.Mocked<LLMPlugin>;

    beforeEach(() => {
      mockPlugin = {
        settings: {
          modalSettings: {
            assistant: false,
            assistantId: 'modal-assistant',
            model: 'gpt-3.5-turbo',
            modelName: 'ChatGPT-3.5',
            modelType: 'openAI',
            historyIndex: -1,
            modelEndpoint: 'chat',
            endpointURL: '/chat/completions',
            imageSettings: {
              numberOfImages: 1,
              response_format: 'url',
              size: '1024x1024',
              style: 'vivid',
              quality: 'standard',
            },
            chatSettings: {
              maxTokens: 300,
              temperature: 0.65,
            },
          },
          widgetSettings: {
            assistant: false,
            assistantId: 'widget-assistant',
            model: 'gpt-4',
            modelName: 'ChatGPT-4',
            modelType: 'openAI',
            historyIndex: -1,
            modelEndpoint: 'chat',
            endpointURL: '/chat/completions',
            imageSettings: {
              numberOfImages: 1,
              response_format: 'url',
              size: '1024x1024',
              style: 'vivid',
              quality: 'standard',
            },
            chatSettings: {
              maxTokens: 500,
              temperature: 0.7,
            },
          },
          fabSettings: {
            assistant: true,
            assistantId: 'fab-assistant',
            model: 'claude-3-sonnet',
            modelName: 'Claude Sonnet',
            modelType: 'claude',
            historyIndex: 0,
            modelEndpoint: 'messages',
            endpointURL: '/v1/messages',
            imageSettings: {
              numberOfImages: 1,
              response_format: 'url',
              size: '1024x1024',
              style: 'natural',
              quality: 'standard',
            },
            chatSettings: {
              maxTokens: 200,
              temperature: 0.5,
            },
          },
        },
      } as any;
    });

    it('should return modal settings for modal view type', () => {
      const result = getViewInfo(mockPlugin, 'modal');
      expect(result.model).toBe('gpt-3.5-turbo');
      expect(result.assistantId).toBe('modal-assistant');
      expect(result.chatSettings.maxTokens).toBe(300);
    });

    it('should return widget settings for widget view type', () => {
      const result = getViewInfo(mockPlugin, 'widget');
      expect(result.model).toBe('gpt-4');
      expect(result.assistantId).toBe('widget-assistant');
      expect(result.chatSettings.maxTokens).toBe(500);
    });

    it('should return fab settings for floating-action-button view type', () => {
      const result = getViewInfo(mockPlugin, 'floating-action-button');
      expect(result.model).toBe('claude-3-sonnet');
      expect(result.assistantId).toBe('fab-assistant');
      expect(result.assistant).toBe(true);
      expect(result.chatSettings.maxTokens).toBe(200);
    });

    it('should return default settings for unknown view type', () => {
      const result = getViewInfo(mockPlugin, 'unknown' as ViewType);
      expect(result.model).toBe('');
      expect(result.assistantId).toBe('');
      expect(result.assistant).toBe(false);
      expect(result.historyIndex).toBe(-1);
    });
  });

  describe('getSettingType', () => {
    it('should return correct setting type for modal', () => {
      expect(getSettingType('modal')).toBe('modalSettings');
    });

    it('should return correct setting type for widget', () => {
      expect(getSettingType('widget')).toBe('widgetSettings');
    });

    it('should return correct setting type for floating-action-button', () => {
      expect(getSettingType('floating-action-button')).toBe('fabSettings');
    });
  });

  describe('setHistoryIndex', () => {
    let mockPlugin: jest.Mocked<LLMPlugin>;

    beforeEach(() => {
      mockPlugin = {
        settings: {
          modalSettings: { historyIndex: 0 },
          widgetSettings: { historyIndex: 0 },
          fabSettings: { historyIndex: 0 },
        },
        saveSettings: jest.fn(),
      } as any;
    });

    it('should set history index to -1 when no length provided', () => {
      setHistoryIndex(mockPlugin, 'modal');
      expect(mockPlugin.settings.modalSettings.historyIndex).toBe(-1);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
    });

    it('should set history index to length - 1 when length provided', () => {
      setHistoryIndex(mockPlugin, 'widget', 5);
      expect(mockPlugin.settings.widgetSettings.historyIndex).toBe(4);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
    });

    it('should work with fab settings', () => {
      setHistoryIndex(mockPlugin, 'floating-action-button', 3);
      expect(mockPlugin.settings.fabSettings.historyIndex).toBe(2);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
    });
  });

  describe('getAssistant', () => {
    let mockPlugin: jest.Mocked<LLMPlugin>;

    beforeEach(() => {
      mockPlugin = {
        settings: {
          assistants: [
            { id: 'assistant-1', name: 'Test Assistant 1', modelType: 'openAI' },
            { id: 'assistant-2', name: 'Test Assistant 2', modelType: 'claude' },
          ],
        },
      } as any;
    });

    it('should find assistant by id', () => {
      const result = getAssistant(mockPlugin, 'assistant-1');
      expect(result.id).toBe('assistant-1');
      expect(result.name).toBe('Test Assistant 1');
      expect(result.modelType).toBe('openAI');
    });

    it('should return undefined for non-existent assistant', () => {
      const result = getAssistant(mockPlugin, 'non-existent');
      expect(result).toBeUndefined();
    });
  });
});