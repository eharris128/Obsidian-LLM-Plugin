# Provider Setup Guide

The LLM plugin supports multiple cloud and local providers. Each provider requires its own configuration.

## Cloud Providers

### OpenAI

**Models:** GPT-3.5 Turbo, GPT-4o, GPT-4o-mini, GPT-4.1 (nano/mini/full), o3, o3-mini, o4-mini, gpt-image-1

**Setup:**
1. Get an API key from [platform.openai.com](https://platform.openai.com)
2. Enter the key in plugin settings under the OpenAI section

**Features:**
- Chat completions (streaming)
- Image generation via gpt-image-1
- OpenAI Assistants integration

### Anthropic Claude

**Models:** Claude 3.5 Sonnet, Claude Sonnet 4.6, Claude Opus 4.6, Claude Haiku 4.5

**Setup:**
1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. Enter the key in plugin settings under the Anthropic section

**Features:**
- Chat completions (streaming)
- Claude Code agent mode (requires OAuth token)

### Google Gemini

**Models:** Gemini 1.5 Flash/Pro, Gemini 2.0 Flash variants, Gemini 2.5 Flash/Pro, Gemini 3 Pro Preview

**Setup:**
1. Get an API key from [aistudio.google.com](https://aistudio.google.com)
2. Enter the key in plugin settings under the Google section

**Features:**
- Chat completions (streaming)
- Automatic retry with exponential backoff for 429 rate limits

### Mistral AI

**Models:** Mistral Large, Medium, Small, Nemo, Magistral Medium/Small, Devstral Small, Codestral

**Setup:**
1. Get an API key from [console.mistral.ai](https://console.mistral.ai)
2. Enter the key in plugin settings under the Mistral section

**Features:**
- Chat completions (streaming)
- Uses the OpenAI SDK with Mistral's base URL

## Local Providers

### Ollama

**Models:** Dynamically discovered from your local Ollama installation

**Setup:**
1. Install Ollama from [ollama.com](https://ollama.com)
2. Pull models you want to use: `ollama pull llama3`
3. In plugin settings, configure the host (default: `http://localhost:11434`)
4. Click "Discover Models" to detect available models

**Features:**
- Chat completions (streaming)
- Automatic model discovery
- No API key required

### GPT4All

**Models:** 13 built-in models including Mistral Instruct, GPT4All Falcon, Llama variants, and more

**Setup:**
1. Download GPT4All from [gpt4all.io](https://gpt4all.io)
2. Download models through GPT4All's model browser
3. In GPT4All settings, enable "Enable Local Server" (runs on port 4891)

**Features:**
- Chat completions
- Optional streaming mode (toggle in plugin settings)
- No API key required
