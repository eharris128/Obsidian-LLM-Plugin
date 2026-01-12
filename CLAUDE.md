# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm run dev      # Start development with watch mode (esbuild watches for changes)
npm run build    # Production build (TypeScript type-check + esbuild bundle)
npm run version  # Bump version in manifest.json and versions.json
```

Output is bundled to `main.js` in the root directory.

## Architecture Overview

This is an Obsidian plugin that provides LLM chat interfaces with support for OpenAI, Anthropic Claude, Google Gemini, and local GPT4All.

### Entry Point and Plugin Lifecycle

`src/main.ts` contains the `LLMPlugin` class which:
1. Initializes platform abstractions (Desktop vs Mobile)
2. Loads settings from Obsidian's data store
3. Registers commands and views
4. Initializes MessageStore, History, Assistants, and FAB components

### View Architecture (Three UI Implementations)

The plugin provides three ways to access the chat interface, all using the same underlying components:

- **Modal** (`src/Plugin/Modal/ChatModal2.ts`) - Popup dialog
- **Widget** (`src/Plugin/Widget/Widget.ts`) - Sidebar tab view
- **FAB** (`src/Plugin/FAB/FAB.ts`) - Floating Action Button with expandable chat

Each view composes these shared components from `src/Plugin/Components/`:
- `Header.ts` - Tab navigation (Chat/History/Settings/Assistants)
- `ChatContainer.ts` - Message display, input handling, API calls
- `HistoryContainer.ts` - Chat history list
- `SettingsContainer.ts` - Model/parameter configuration
- `AssistantsContainer.ts` - OpenAI assistants selection

### State Management

- **MessageStore** (`src/Plugin/Components/MessageStore.ts`) - Pub/sub pattern for in-memory message state; synchronizes all views
- **Settings** (in `main.ts`) - Persisted configuration via Obsidian's `loadData`/`saveData`
- **HistoryHandler** (`src/History/HistoryHandler.ts`) - Manages chat history (max 10 conversations)
- **AssistantHandler** (`src/Assistants/AssistantHandler.ts`) - OpenAI assistants state

### Message Flow

1. User input in `ChatContainer` triggers `handleGenerateClick()`
2. Message added to MessageStore, which notifies all subscribers
3. API call made based on selected provider (OpenAI/Claude/Gemini/GPT4All)
4. Streaming response updates UI in real-time
5. Conversation saved to History

### Platform Abstraction

`src/services/` provides abstractions for cross-platform compatibility:
- `FileSystem.ts` - Desktop/Mobile file operations
- `OperatingSystem.ts` - Desktop/Mobile OS detection

### API Integration

Provider SDKs used:
- `openai` - Chat, images, assistants
- `@anthropic-ai/sdk` - Claude models
- `@google/generative-ai` - Gemini models
- GPT4All connects to local server on port 4891

### Key Files

- `src/Types/types.ts` - TypeScript interfaces (ChatParams, ImageParams, etc.)
- `src/utils/constants.ts` - Provider/model/endpoint constants
- `src/utils/models.ts` - Model configuration definitions
- `src/utils/utils.ts` - API validation and helper functions

## Build Configuration

- **esbuild** bundles to CommonJS format targeting ES2018
- External dependencies: `obsidian`, `electron`, `@codemirror/*`, Node builtins
- SVG files loaded inline via esbuild loader
- TypeScript configured with strict null checks, baseUrl `src`
