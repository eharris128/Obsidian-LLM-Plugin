import { Assistants } from '../../../src/Assistants/AssistantHandler';
import { AIAssistant } from '../../../src/Types/types';
import LLMPlugin from '../../../src/main';

describe('Assistants Handler', () => {
  let assistants: Assistants;
  let mockPlugin: jest.Mocked<LLMPlugin>;

  beforeEach(() => {
    mockPlugin = {
      settings: {
        assistants: [],
      },
      saveSettings: jest.fn(),
    } as any;

    assistants = new Assistants(mockPlugin);
    jest.clearAllMocks();
  });

  describe('push', () => {
    it('should successfully add an assistant to the settings', () => {
      const testAssistant: AIAssistant = {
        id: 'test-assistant-1',
        name: 'Test Assistant',
        description: 'A test assistant',
        model: 'gpt-3.5-turbo',
        instructions: 'You are a helpful assistant',
        tools: [],
        metadata: {},
        created_at: Date.now(),
        object: 'assistant',
        modelType: 'openAI',
      } as AIAssistant;

      const result = assistants.push(testAssistant);

      expect(result).toBe(true);
      expect(mockPlugin.settings.assistants).toHaveLength(1);
      expect(mockPlugin.settings.assistants[0]).toEqual(testAssistant);
      expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('should add multiple assistants', () => {
      const assistant1: AIAssistant = {
        id: 'assistant-1',
        name: 'Assistant 1',
        description: 'First assistant',
        model: 'gpt-3.5-turbo',
        instructions: 'Instructions 1',
        tools: [],
        metadata: {},
        created_at: Date.now(),
        object: 'assistant',
        modelType: 'openAI',
      } as AIAssistant;

      const assistant2: AIAssistant = {
        id: 'assistant-2',
        name: 'Assistant 2',
        description: 'Second assistant',
        model: 'claude-3-sonnet',
        instructions: 'Instructions 2',
        tools: [],
        metadata: {},
        created_at: Date.now(),
        object: 'assistant',
        modelType: 'claude',
      } as AIAssistant;

      assistants.push(assistant1);
      assistants.push(assistant2);

      expect(mockPlugin.settings.assistants).toHaveLength(2);
      expect(mockPlugin.settings.assistants[0]).toEqual(assistant1);
      expect(mockPlugin.settings.assistants[1]).toEqual(assistant2);
      expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(2);
    });

    it('should preserve existing assistants when adding new ones', () => {
      // Setup existing assistant
      const existingAssistant: AIAssistant = {
        id: 'existing-assistant',
        name: 'Existing Assistant',
        description: 'Already exists',
        model: 'gpt-4',
        instructions: 'Existing instructions',
        tools: [],
        metadata: {},
        created_at: Date.now() - 1000,
        object: 'assistant',
        modelType: 'openAI',
      } as AIAssistant;

      mockPlugin.settings.assistants = [existingAssistant];

      const newAssistant: AIAssistant = {
        id: 'new-assistant',
        name: 'New Assistant',
        description: 'Newly added',
        model: 'claude-3-sonnet',
        instructions: 'New instructions',
        tools: [],
        metadata: {},
        created_at: Date.now(),
        object: 'assistant',
        modelType: 'claude',
      } as AIAssistant;

      const result = assistants.push(newAssistant);

      expect(result).toBe(true);
      expect(mockPlugin.settings.assistants).toHaveLength(2);
      expect(mockPlugin.settings.assistants[0]).toEqual(existingAssistant);
      expect(mockPlugin.settings.assistants[1]).toEqual(newAssistant);
    });

    it('should return false when an exception occurs', () => {
      // Mock saveSettings to throw an error
      mockPlugin.saveSettings.mockImplementation(() => {
        throw new Error('Save failed');
      });

      const testAssistant: AIAssistant = {
        id: 'error-assistant',
        name: 'Error Assistant',
        description: 'Will cause error',
        model: 'gpt-3.5-turbo',
        instructions: 'Error instructions',
        tools: [],
        metadata: {},
        created_at: Date.now(),
        object: 'assistant',
        modelType: 'openAI',
      } as AIAssistant;

      const result = assistants.push(testAssistant);

      expect(result).toBe(false);
    });

    it('should handle assistants with different modelTypes', () => {
      const openAIAssistant: AIAssistant = {
        id: 'openai-assistant',
        name: 'OpenAI Assistant',
        description: 'OpenAI model',
        model: 'gpt-4',
        instructions: 'OpenAI instructions',
        tools: [],
        metadata: {},
        created_at: Date.now(),
        object: 'assistant',
        modelType: 'openAI',
      } as AIAssistant;

      const claudeAssistant: AIAssistant = {
        id: 'claude-assistant',
        name: 'Claude Assistant',
        description: 'Claude model',
        model: 'claude-3-sonnet',
        instructions: 'Claude instructions',
        tools: [],
        metadata: {},
        created_at: Date.now(),
        object: 'assistant',
        modelType: 'claude',
      } as AIAssistant;

      assistants.push(openAIAssistant);
      assistants.push(claudeAssistant);

      expect(mockPlugin.settings.assistants).toHaveLength(2);
      expect(mockPlugin.settings.assistants[0].modelType).toBe('openAI');
      expect(mockPlugin.settings.assistants[1].modelType).toBe('claude');
    });
  });

  describe('reset', () => {
    it('should clear all assistants from settings', () => {
      // Setup some existing assistants
      const assistant1: AIAssistant = {
        id: 'assistant-1',
        name: 'Assistant 1',
        modelType: 'openAI',
      } as AIAssistant;

      const assistant2: AIAssistant = {
        id: 'assistant-2',
        name: 'Assistant 2',
        modelType: 'claude',
      } as AIAssistant;

      mockPlugin.settings.assistants = [assistant1, assistant2];

      assistants.reset();

      expect(mockPlugin.settings.assistants).toEqual([]);
      expect(mockPlugin.settings.assistants).toHaveLength(0);
      expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('should work when assistants array is already empty', () => {
      mockPlugin.settings.assistants = [];

      assistants.reset();

      expect(mockPlugin.settings.assistants).toEqual([]);
      expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('should work after pushing and then resetting', () => {
      const testAssistant: AIAssistant = {
        id: 'test-assistant',
        name: 'Test Assistant',
        modelType: 'openAI',
      } as AIAssistant;

      assistants.push(testAssistant);
      expect(mockPlugin.settings.assistants).toHaveLength(1);

      assistants.reset();
      expect(mockPlugin.settings.assistants).toHaveLength(0);
      expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(2); // Once for push, once for reset
    });
  });

  describe('constructor', () => {
    it('should store the plugin reference', () => {
      const newAssistants = new Assistants(mockPlugin);
      expect((newAssistants as any).plugin).toBe(mockPlugin);
    });
  });
});