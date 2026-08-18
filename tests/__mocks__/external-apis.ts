// Mock external API clients for testing

// Mock OpenAI
export const mockOpenAI = {
  models: {
    list: jest.fn().mockResolvedValue({ data: [] }),
  },
  chat: {
    completions: {
      create: jest.fn().mockResolvedValue({
        choices: [{ message: { content: 'Test response' } }],
      }),
    },
  },
  images: {
    generate: jest.fn().mockResolvedValue({
      data: [{ url: 'https://example.com/image.jpg' }],
    }),
  },
  beta: {
    assistants: {
      list: jest.fn().mockResolvedValue({ data: [] }),
      create: jest.fn().mockResolvedValue({ id: 'test-assistant' }),
      del: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    threads: {
      create: jest.fn().mockResolvedValue({ id: 'test-thread' }),
      runs: {
        stream: jest.fn().mockResolvedValue({}),
      },
    },
    vectorStores: {
      list: jest.fn().mockResolvedValue({ data: [] }),
      create: jest.fn().mockResolvedValue({ id: 'test-vector' }),
      del: jest.fn().mockResolvedValue({}),
      fileBatches: {
        create: jest.fn().mockResolvedValue({}),
      },
    },
  },
  files: {
    create: jest.fn().mockResolvedValue({ id: 'test-file' }),
  },
};

// Mock Anthropic/Claude
export const mockAnthropic = {
  messages: {
    create: jest.fn().mockResolvedValue({
      content: [{ text: 'Test Claude response' }],
    }),
    stream: jest.fn().mockReturnValue({
      on: jest.fn(),
    }),
  },
};

// Mock Google Generative AI
export const mockGoogleAI = {
  getGenerativeModel: jest.fn().mockReturnValue({
    generateContent: jest.fn().mockResolvedValue({
      response: {
        text: jest.fn().mockReturnValue('Test Gemini response'),
      },
    }),
    generateContentStream: jest.fn().mockResolvedValue({
      stream: {},
    }),
  }),
};

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => mockOpenAI);
});

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => mockAnthropic);
});

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => mockGoogleAI),
}));