# LLM Plugin — Skills

Skills are custom, reusable prompts you create directly in your Obsidian vault. Each skill can inject instructions into the model's context, restrict which tools it can use, accept arguments, or even bypass the model entirely and return a templated response.

---

## Creating a Skill

Each skill lives in its own folder inside `<root>/Skills/`, where `<root>` is the root vault folder configured in Settings → General (default: `AI`). The folder name becomes the skill's ID — what you type after the `/` to invoke it.

```
AI/
  Skills/
    summarize-note/
      SKILL.md
    daily-template/
      SKILL.md
    code-review/
      SKILL.md
```

> To change the root folder, go to Settings → General → "Root vault folder". All AI features share this root.

Inside each folder, create a file called `SKILL.md`. It has two parts: a frontmatter block and an instruction body.

```yaml
---
name: Summarize Note
description: Summarizes a note in three bullet points
allowed-tools:
  - obsidian_read_note
disable-model-invocation: false
argument-hint: "[note name]"
---

Please summarize the note titled "{{args}}" in exactly three bullet points. Be concise.
```

---

## Frontmatter Fields

### `name`
The display name shown in the skill picker. Can include spaces and capitalization. If omitted, falls back to the folder name.

### `description`
A short description shown below the skill name in the picker. Helps you remember what the skill does when you have many of them.

### `allowed-tools`
Restricts which vault tools the model can call during this skill. Available tools include things like `obsidian_read_note`, `obsidian_search`, and `search_vault_semantic`. If left empty (or omitted entirely), all tools are available.

```yaml
allowed-tools:
  - obsidian_read_note
  - obsidian_search
```

### `disable-model-invocation`
When set to `true`, the skill's instruction body is returned directly as the response — no API call is made. This is useful for pure templates and canned responses that don't need AI generation. Defaults to `false`.

### `argument-hint`
A short hint shown grayed-out next to the skill name in the picker (e.g., `[note name]`). This is purely visual — it reminds you what to type after selecting the skill.

---

## The Instruction Body

Everything below the `---` frontmatter block is the instruction body. This text is injected into the model's context as a system-level instruction when the skill is active.

### `{{args}}` substitution

Use `{{args}}` anywhere in the instruction body as a placeholder. It will be replaced at send time with whatever text you typed after the skill name in the chat input.

**Example:**

Skill instruction:
```
Translate the following text into formal Spanish: {{args}}
```

You type in the chat:
```
/translate Hello, how are you doing today?
```

What the model receives:
```
Translate the following text into formal Spanish: Hello, how are you doing today?
```

If no args are provided (you just type `/translate` with nothing after it), `{{args}}` is left as-is in the instruction body.

---

## Invoking a Skill

There are three ways to activate a skill:

**1. Slash command**
Type `/` in the chat input. A picker appears listing all your skills. You can keep typing to filter by name, use arrow keys to navigate, and press `Tab` or `Enter` to select. The selected skill is inserted as `/skill-id ` (with a trailing space) in the text field — you can then type your message after it.

**2. Plus button menu**
Click the `+` button in the chat toolbar. Choose "Add a skill" from the menu, then pick from the submenu. The skill prefix is inserted into the text field just like with the slash command.

**3. Global enable**
Go to Settings → Skills and toggle a skill on. Enabled skills have their instructions injected into every message automatically, across all chat views, without needing to type a slash command. Their `allowed-tools` are unioned together if multiple skills are enabled.

---

## The Skill Picker

When you type `/` in the chat input, a floating menu appears above the text field showing all your skills. Each card shows:

- The skill's icon
- The skill name and argument hint (e.g., `Summarize Note  [note name]`)
- A short description
- A pencil icon (on hover) that opens the skill's `SKILL.md` file directly in Obsidian for editing

Keyboard shortcuts in the picker:
- `↑` / `↓` — navigate skills
- `Tab` or `Enter` — select the highlighted skill
- `Escape` — dismiss the picker

Once a skill is selected, its ID appears in your accent color in the text field (e.g., `/summarize-note `). You can backspace to remove it if you change your mind.

---

## Pure Template Skills (`disable-model-invocation: true`)

When `disable-model-invocation` is `true`, activating the skill returns the instruction body directly as the chat response — no API call is made and no tokens are spent. Combined with `{{args}}`, this lets you build instant canned-response skills.

**Example — a meeting notes template:**

```yaml
---
name: Meeting Notes
description: Inserts a blank meeting notes template
disable-model-invocation: true
argument-hint: "[meeting title]"
---

# Meeting Notes — {{args}}

**Date:** 
**Attendees:** 

## Agenda

- 

## Discussion

## Action Items

- [ ] 
```

Typing `/meeting-notes Q2 Planning` instantly outputs the template with "Q2 Planning" filled in — no model call needed.

---

## Tips

- Skill IDs come from the folder name, not the `name:` field. Keep folder names lowercase with hyphens (e.g., `code-review`, `daily-template`).
- The `allowed-tools` restriction only applies when the selected model supports agent/tool-calling mode (Claude, GPT-4, Gemini). On Ollama or Mistral models without tool support, the restriction has no effect.
- Skills hot-reload whenever you save a `SKILL.md` file — no need to restart Obsidian.
- You can have globally-enabled skills running in the background while also using a slash-invoked skill for a specific message. The slash skill takes priority; the global skills are ignored for that turn.
