import { 
  ChatHistoryItem, 
  ImageHistoryItem, 
  AssistantHistoryItem, 
  AIAssistant, 
  Message,
  ViewSettings,
  LLMPluginSettings 
} from '../../src/Types/types';
import { DEFAULT_SETTINGS } from '../../src/main';

// Test messages
export const testMessages: Message[] = [
  { role: 'user', content: 'Hello, how are you?' },
  { role: 'assistant', content: 'I am doing well, thank you for asking!' },
  { role: 'user', content: 'Can you help me with a task?' },
  { role: 'assistant', content: 'Of course! I would be happy to help you. What do you need assistance with?' },
];

export const singleUserMessage: Message[] = [
  { role: 'user', content: 'What is the capital of France?' },
];

export const longConversation: Message[] = [
  { role: 'user', content: 'Tell me about artificial intelligence' },
  { role: 'assistant', content: 'Artificial Intelligence (AI) refers to the simulation of human intelligence in machines...' },
  { role: 'user', content: 'What are the main types of AI?' },
  { role: 'assistant', content: 'There are several ways to categorize AI, but commonly we distinguish between...' },
  { role: 'user', content: 'How does machine learning work?' },
  { role: 'assistant', content: 'Machine learning is a subset of AI that enables systems to learn and improve...' },
];

// Test history items
export const testChatHistoryItem: ChatHistoryItem = {
  prompt: 'Test chat prompt',
  messages: testMessages,
  model: 'gpt-3.5-turbo',
  modelName: 'ChatGPT-3.5 Turbo',
  temperature: 0.7,
  tokens: 150,
  frequencyPenalty: 0,
  logProbs: false,
  topLogProbs: null,
  presencePenalty: 0,
  responseFormat: '',
  topP: 1,
};

export const testImageHistoryItem: ImageHistoryItem = {
  prompt: 'A beautiful sunset over mountains',
  messages: singleUserMessage,
  model: 'dall-e-3',
  modelName: 'DALL-E 3',
  numberOfImages: 1,
  response_format: 'url',
  size: '1024x1024',
  style: 'vivid',
  quality: 'hd',
  temperature: 0.8,
  tokens: 100,
};

export const testAssistantHistoryItem: AssistantHistoryItem = {
  prompt: 'Assistant test prompt',
  messages: testMessages,
  model: 'gpt-4',
  assistant_id: 'asst_test123',
  modelName: 'GPT-4 Assistant',
};

// Test assistants
export const testOpenAIAssistant: AIAssistant = {
  id: 'asst_openai_test',
  name: 'Test OpenAI Assistant',
  description: 'A test assistant for OpenAI',
  model: 'gpt-4',
  instructions: 'You are a helpful test assistant specializing in software development.',
  tools: [{ type: 'code_interpreter' }],
  metadata: { purpose: 'testing' },
  created_at: 1699000000,
  object: 'assistant',
  modelType: 'openAI',
};

export const testClaudeAssistant: AIAssistant = {
  id: 'asst_claude_test',
  name: 'Test Claude Assistant',
  description: 'A test assistant for Claude',
  model: 'claude-3-sonnet-20240229',
  instructions: 'You are a thoughtful test assistant focused on detailed analysis.',
  tools: [],
  metadata: { purpose: 'testing', domain: 'analysis' },
  created_at: 1699000100,
  object: 'assistant',
  modelType: 'claude',
};

// Test view settings
export const testModalSettings: ViewSettings = {
  assistant: false,
  assistantId: '',
  model: 'gpt-3.5-turbo',
  modelName: 'ChatGPT-3.5 Turbo',
  modelType: 'openAI',
  modelEndpoint: 'chat',
  endpointURL: '/chat/completions',
  historyIndex: -1,
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
    GPT4All: {},
    openAI: {
      frequencyPenalty: 0,
      logProbs: false,
      topLogProbs: null,
      presencePenalty: 0,
      responseFormat: '',
      topP: 1,
    },
  },
};

export const testWidgetSettings: ViewSettings = {
  ...testModalSettings,
  model: 'gpt-4',
  modelName: 'ChatGPT-4',
  chatSettings: {
    ...testModalSettings.chatSettings,
    maxTokens: 500,
    temperature: 0.8,
  },
};

export const testFabSettings: ViewSettings = {
  ...testModalSettings,
  assistant: true,
  assistantId: 'asst_fab_test',
  model: 'claude-3-sonnet-20240229',
  modelName: 'Claude 3 Sonnet',
  modelType: 'claude',
  modelEndpoint: 'messages',
  endpointURL: '/v1/messages',
  chatSettings: {
    ...testModalSettings.chatSettings,
    maxTokens: 200,
    temperature: 0.5,
  },
};

// Test plugin settings
export const testPluginSettings: LLMPluginSettings = {
  ...DEFAULT_SETTINGS,
  modalSettings: testModalSettings,
  widgetSettings: testWidgetSettings,
  fabSettings: testFabSettings,
  promptHistory: [testChatHistoryItem, testAssistantHistoryItem],
  assistants: [testOpenAIAssistant, testClaudeAssistant],
  openAIAPIKey: 'sk-test-openai-key',
  claudeAPIKey: 'test-claude-key',
  geminiAPIKey: 'test-gemini-key',
  defaultModel: 'gpt-3.5-turbo',
};

// Mock API responses
export const mockOpenAIResponse = {
  choices: [
    {
      message: {
        role: 'assistant',
        content: 'This is a test response from OpenAI',
      },
      finish_reason: 'stop',
    },
  ],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 15,
    total_tokens: 25,
  },
};

export const mockClaudeResponse = {
  content: [
    {
      type: 'text',
      text: 'This is a test response from Claude',
    },
  ],
  role: 'assistant',
  stop_reason: 'end_turn',
  usage: {
    input_tokens: 10,
    output_tokens: 15,
  },
};

export const mockGeminiResponse = {
  response: {
    text: () => 'This is a test response from Gemini',
    candidates: [
      {
        content: {
          parts: [{ text: 'This is a test response from Gemini' }],
        },
      },
    ],
  },
};

// Utility functions for creating test data
export function createTestMessage(role: 'user' | 'assistant', content: string): Message {
  return { role, content };
}

export function createTestChatHistory(prompt: string, model: string = 'gpt-3.5-turbo'): ChatHistoryItem {
  return {
    prompt,
    messages: [createTestMessage('user', prompt)],
    model,
    modelName: model === 'gpt-3.5-turbo' ? 'ChatGPT-3.5 Turbo' : 'ChatGPT-4',
    temperature: 0.7,
    tokens: 100,
    frequencyPenalty: 0,
    logProbs: false,
    topLogProbs: null,
    presencePenalty: 0,
    responseFormat: '',
    topP: 1,
  };
}

export function createTestAssistant(id: string, name: string, modelType: 'openAI' | 'claude' = 'openAI'): AIAssistant {
  return {
    id,
    name,
    description: `Test assistant: ${name}`,
    model: modelType === 'openAI' ? 'gpt-4' : 'claude-3-sonnet-20240229',
    instructions: `You are ${name}, a test assistant.`,
    tools: [],
    metadata: { test: true },
    created_at: Date.now(),
    object: 'assistant',
    modelType,
  };
}