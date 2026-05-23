/**
 * BuiltinSkills — skill content strings that ship with the plugin.
 *
 * On first run (or whenever a built-in skill folder is absent) the plugin
 * seeds these files into the user's vault under <rootVaultFolder>/Skills/.
 * Existing files are NEVER overwritten, so user edits are safe.
 *
 * All content sourced from https://github.com/kepano/obsidian-skills (MIT license, © kepano).
 */

export interface BuiltinSkillDef {
	/** Folder name inside <skillsFolder>/ — also becomes the skill id. */
	id: string;
	/** The full SKILL.md content to write. */
	content: string;
}

const OBSIDIAN_MARKDOWN: BuiltinSkillDef = {
	id: "obsidian-markdown",
	content: `---
name: obsidian-markdown
description: Create and edit Obsidian Flavored Markdown with wikilinks, embeds, callouts, properties, and other Obsidian-specific syntax. Use when working with .md files in Obsidian, or when the user mentions wikilinks, callouts, frontmatter, tags, embeds, or Obsidian notes.
---

# Obsidian Flavored Markdown Skill

Create and edit valid Obsidian Flavored Markdown. Obsidian extends CommonMark and GFM with wikilinks, embeds, callouts, properties, comments, and other syntax. This skill covers only Obsidian-specific extensions -- standard Markdown (headings, bold, italic, lists, quotes, code blocks, tables) is assumed knowledge.

## Workflow: Creating an Obsidian Note

1. **Add frontmatter** with properties (title, tags, aliases) at the top of the file.
2. **Write content** using standard Markdown for structure, plus Obsidian-specific syntax below.
3. **Link related notes** using wikilinks (\`[[Note]]\`) for internal vault connections, or standard Markdown links for external URLs.
4. **Embed content** from other notes, images, or PDFs using the \`![[embed]]\` syntax.
5. **Add callouts** for highlighted information using \`> [!type]\` syntax.
6. **Verify** the note renders correctly in Obsidian's reading view.

> When choosing between wikilinks and Markdown links: use \`[[wikilinks]]\` for notes within the vault (Obsidian tracks renames automatically) and \`[text](url)\` for external URLs only.

## Internal Links (Wikilinks)

\`\`\`markdown
[[Note Name]]                          Link to note
[[Note Name|Display Text]]             Custom display text
[[Note Name#Heading]]                  Link to heading
[[Note Name#^block-id]]                Link to block
[[#Heading in same note]]              Same-note heading link
\`\`\`

Define a block ID by appending \`^block-id\` to any paragraph:

\`\`\`markdown
This paragraph can be linked to. ^my-block-id
\`\`\`

For lists and quotes, place the block ID on a separate line after the block:

\`\`\`markdown
> A quote block

^quote-id
\`\`\`

## Embeds

Prefix any wikilink with \`!\` to embed its content inline:

\`\`\`markdown
![[Note Name]]                         Embed full note
![[Note Name#Heading]]                 Embed section
![[image.png]]                         Embed image
![[image.png|300]]                     Embed image with width
![[document.pdf#page=3]]               Embed PDF page
\`\`\`

## Callouts

\`\`\`markdown
> [!note]
> Basic callout.

> [!warning] Custom Title
> Callout with a custom title.

> [!faq]- Collapsed by default
> Foldable callout (- collapsed, + expanded).
\`\`\`

Common types: \`note\`, \`tip\`, \`warning\`, \`info\`, \`example\`, \`quote\`, \`bug\`, \`danger\`, \`success\`, \`failure\`, \`question\`, \`abstract\`, \`todo\`.

## Properties (Frontmatter)

\`\`\`yaml
---
title: My Note
date: 2024-01-15
tags:
  - project
  - active
aliases:
  - Alternative Name
cssclasses:
  - custom-class
---
\`\`\`

Default properties: \`tags\` (searchable labels), \`aliases\` (alternative note names for link suggestions), \`cssclasses\` (CSS classes for styling).

## Tags

\`\`\`markdown
#tag                    Inline tag
#nested/tag             Nested tag with hierarchy
\`\`\`

Tags can contain letters, numbers (not first character), underscores, hyphens, and forward slashes. Tags can also be defined in frontmatter under the \`tags\` property.

## Comments

\`\`\`markdown
This is visible %%but this is hidden%% text.

%%
This entire block is hidden in reading view.
%%
\`\`\`

## Obsidian-Specific Formatting

\`\`\`markdown
==Highlighted text==                   Highlight syntax
\`\`\`

## Math (LaTeX)

\`\`\`markdown
Inline: $e^{i\\pi} + 1 = 0$

Block:
$$
\\frac{a}{b} = c
$$
\`\`\`

## Diagrams (Mermaid)

\`\`\`\`markdown
\`\`\`mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Do this]
    B -->|No| D[Do that]
\`\`\`
\`\`\`\`

To link Mermaid nodes to Obsidian notes, add \`class NodeName internal-link;\`.

## Footnotes

\`\`\`markdown
Text with a footnote[^1].

[^1]: Footnote content.

Inline footnote.^[This is inline.]
\`\`\`

## Complete Example

\`\`\`markdown
---
title: Project Alpha
date: 2024-01-15
tags:
  - project
  - active
status: in-progress
---

# Project Alpha

This project aims to [[improve workflow]] using modern techniques.

> [!important] Key Deadline
> The first milestone is due on ==January 30th==.

## Tasks

- [x] Initial planning
- [ ] Development phase
  - [ ] Backend implementation
  - [ ] Frontend design

## Notes

The algorithm uses $O(n \\log n)$ sorting. See [[Algorithm Notes#Sorting]] for details.

![[Architecture Diagram.png|600]]

Reviewed in [[Meeting Notes 2024-01-10#Decisions]].
\`\`\`

## References

- [Obsidian Flavored Markdown](https://help.obsidian.md/obsidian-flavored-markdown)
- [Internal links](https://help.obsidian.md/links)
- [Embed files](https://help.obsidian.md/embeds)
- [Callouts](https://help.obsidian.md/callouts)
- [Properties](https://help.obsidian.md/properties)
`,
};

const OBSIDIAN_BASES: BuiltinSkillDef = {
	id: "obsidian-bases",
	content: `---
name: obsidian-bases
description: Create and edit Obsidian Bases (.base files) with views, filters, formulas, and summaries. Use when working with .base files, creating database-like views of notes, or when the user mentions Bases, table views, card views, filters, or formulas in Obsidian.
---

# Obsidian Bases Skill

## Workflow

1. **Create the file**: Create a \`.base\` file in the vault with valid YAML content
2. **Define scope**: Add \`filters\` to select which notes appear (by tag, folder, property, or date)
3. **Add formulas** (optional): Define computed properties in the \`formulas\` section
4. **Configure views**: Add one or more views (\`table\`, \`cards\`, \`list\`, or \`map\`) with \`order\` specifying which properties to display
5. **Validate**: Verify the file is valid YAML with no syntax errors. Check that all referenced properties and formulas exist. Common issues: unquoted strings containing special YAML characters, mismatched quotes in formula expressions, referencing \`formula.X\` without defining \`X\` in \`formulas\`
6. **Test in Obsidian**: Open the \`.base\` file in Obsidian to confirm the view renders correctly. If it shows a YAML error, check quoting rules below

## Schema

Base files use the \`.base\` extension and contain valid YAML.

\`\`\`yaml
# Global filters apply to ALL views in the base
filters:
  # Can be a single filter string
  # OR a recursive filter object with and/or/not
  and: []
  or: []
  not: []

# Define formula properties that can be used across all views
formulas:
  formula_name: 'expression'

# Configure display names and settings for properties
properties:
  property_name:
    displayName: "Display Name"
  formula.formula_name:
    displayName: "Formula Display Name"
  file.ext:
    displayName: "Extension"

# Define custom summary formulas
summaries:
  custom_summary_name: 'values.mean().round(3)'

# Define one or more views
views:
  - type: table | cards | list | map
    name: "View Name"
    limit: 10                    # Optional: limit results
    groupBy:                     # Optional: group results
      property: property_name
      direction: ASC | DESC
    filters:                     # View-specific filters
      and: []
    order:                       # Properties to display in order
      - file.name
      - property_name
      - formula.formula_name
    summaries:                   # Map properties to summary formulas
      property_name: Average
\`\`\`

## Filter Syntax

Filters narrow down results. They can be applied globally or per-view.

### Filter Structure

\`\`\`yaml
# Single filter
filters: 'status == "done"'

# AND - all conditions must be true
filters:
  and:
    - 'status == "done"'
    - 'priority > 3'

# OR - any condition can be true
filters:
  or:
    - 'file.hasTag("book")'
    - 'file.hasTag("article")'

# NOT - exclude matching items
filters:
  not:
    - 'file.hasTag("archived")'

# Nested filters
filters:
  or:
    - file.hasTag("tag")
    - and:
        - file.hasTag("book")
        - file.hasLink("Textbook")
    - not:
        - file.hasTag("book")
        - file.inFolder("Required Reading")
\`\`\`

### Filter Operators

| Operator | Description |
|----------|-------------|
| \`==\` | equals |
| \`!=\` | not equal |
| \`>\` | greater than |
| \`<\` | less than |
| \`>=\` | greater than or equal |
| \`<=\` | less than or equal |
| \`&&\` | logical and |
| \`||\` | logical or |
| \`!\` | logical not |

## Properties

### Three Types of Properties

1. **Note properties** - From frontmatter: \`note.author\` or just \`author\`
2. **File properties** - File metadata: \`file.name\`, \`file.mtime\`, etc.
3. **Formula properties** - Computed values: \`formula.my_formula\`

### File Properties Reference

| Property | Type | Description |
|----------|------|-------------|
| \`file.name\` | String | File name |
| \`file.basename\` | String | File name without extension |
| \`file.path\` | String | Full path to file |
| \`file.folder\` | String | Parent folder path |
| \`file.ext\` | String | File extension |
| \`file.size\` | Number | File size in bytes |
| \`file.ctime\` | Date | Created time |
| \`file.mtime\` | Date | Modified time |
| \`file.tags\` | List | All tags in file |
| \`file.links\` | List | Internal links in file |
| \`file.backlinks\` | List | Files linking to this file |
| \`file.embeds\` | List | Embeds in the note |
| \`file.properties\` | Object | All frontmatter properties |

### The \`this\` Keyword

- In main content area: refers to the base file itself
- When embedded: refers to the embedding file
- In sidebar: refers to the active file in main content

## Formula Syntax

Formulas compute values from properties. Defined in the \`formulas\` section.

\`\`\`yaml
formulas:
  # Simple arithmetic
  total: "price * quantity"

  # Conditional logic
  status_icon: 'if(done, "✅", "⏳")'

  # String formatting
  formatted_price: 'if(price, price.toFixed(2) + " dollars")'

  # Date formatting
  created: 'file.ctime.format("YYYY-MM-DD")'

  # Calculate days since created (use .days for Duration)
  days_old: '(now() - file.ctime).days'

  # Calculate days until due date
  days_until_due: 'if(due_date, (date(due_date) - today()).days, "")'
\`\`\`

## Key Functions

Most commonly used functions.

| Function | Signature | Description |
|----------|-----------|-------------|
| \`date()\` | \`date(string): date\` | Parse string to date (\`YYYY-MM-DD HH:mm:ss\`) |
| \`now()\` | \`now(): date\` | Current date and time |
| \`today()\` | \`today(): date\` | Current date (time = 00:00:00) |
| \`if()\` | \`if(condition, trueResult, falseResult?)\` | Conditional |
| \`duration()\` | \`duration(string): duration\` | Parse duration string |
| \`file()\` | \`file(path): file\` | Get file object |
| \`link()\` | \`link(path, display?): Link\` | Create a link |

### Duration Type

When subtracting two dates, the result is a **Duration** type (not a number).

**Duration Fields:** \`duration.days\`, \`duration.hours\`, \`duration.minutes\`, \`duration.seconds\`, \`duration.milliseconds\`

**IMPORTANT:** Duration does NOT support \`.round()\`, \`.floor()\`, \`.ceil()\` directly. Access a numeric field first (like \`.days\`), then apply number functions.

\`\`\`yaml
# CORRECT: Calculate days between dates
"(date(due_date) - today()).days"                    # Returns number of days
"(now() - file.ctime).days"                          # Days since created
"(date(due_date) - today()).days.round(0)"           # Rounded days

# WRONG - will cause error:
# "((date(due) - today()) / 86400000).round(0)"      # Duration doesn't support division then round
\`\`\`

### Date Arithmetic

\`\`\`yaml
# Duration units: y/year/years, M/month/months, d/day/days,
#                 w/week/weeks, h/hour/hours, m/minute/minutes, s/second/seconds
"now() + \\"1 day\\""       # Tomorrow
"today() + \\"7d\\""        # A week from today
"now() - file.ctime"      # Returns Duration
"(now() - file.ctime).days"  # Get days as number
\`\`\`

## View Types

### Table View

\`\`\`yaml
views:
  - type: table
    name: "My Table"
    order:
      - file.name
      - status
      - due_date
    summaries:
      price: Sum
      count: Average
\`\`\`

### Cards View

\`\`\`yaml
views:
  - type: cards
    name: "Gallery"
    order:
      - file.name
      - cover_image
      - description
\`\`\`

### List View

\`\`\`yaml
views:
  - type: list
    name: "Simple List"
    order:
      - file.name
      - status
\`\`\`

### Map View

Requires latitude/longitude properties and the Maps community plugin.

\`\`\`yaml
views:
  - type: map
    name: "Locations"
    # Map-specific settings for lat/lng properties
\`\`\`

## Default Summary Formulas

| Name | Input Type | Description |
|------|------------|-------------|
| \`Average\` | Number | Mathematical mean |
| \`Min\` | Number | Smallest number |
| \`Max\` | Number | Largest number |
| \`Sum\` | Number | Sum of all numbers |
| \`Range\` | Number | Max - Min |
| \`Median\` | Number | Mathematical median |
| \`Stddev\` | Number | Standard deviation |
| \`Earliest\` | Date | Earliest date |
| \`Latest\` | Date | Latest date |
| \`Checked\` | Boolean | Count of true values |
| \`Unchecked\` | Boolean | Count of false values |
| \`Empty\` | Any | Count of empty values |
| \`Filled\` | Any | Count of non-empty values |
| \`Unique\` | Any | Count of unique values |

## Complete Examples

### Task Tracker Base

\`\`\`yaml
filters:
  and:
    - file.hasTag("task")
    - 'file.ext == "md"'

formulas:
  days_until_due: 'if(due, (date(due) - today()).days, "")'
  is_overdue: 'if(due, date(due) < today() && status != "done", false)'
  priority_label: 'if(priority == 1, "🔴 High", if(priority == 2, "🟡 Medium", "🟢 Low"))'

properties:
  status:
    displayName: Status
  formula.days_until_due:
    displayName: "Days Until Due"
  formula.priority_label:
    displayName: Priority

views:
  - type: table
    name: "Active Tasks"
    filters:
      and:
        - 'status != "done"'
    order:
      - file.name
      - status
      - formula.priority_label
      - due
      - formula.days_until_due
    groupBy:
      property: status
      direction: ASC
    summaries:
      formula.days_until_due: Average

  - type: table
    name: "Completed"
    filters:
      and:
        - 'status == "done"'
    order:
      - file.name
      - completed_date
\`\`\`

### Reading List Base

\`\`\`yaml
filters:
  or:
    - file.hasTag("book")
    - file.hasTag("article")

formulas:
  reading_time: 'if(pages, (pages * 2).toString() + " min", "")'
  status_icon: 'if(status == "reading", "📖", if(status == "done", "✅", "📚"))'
  year_read: 'if(finished_date, date(finished_date).year, "")'

properties:
  author:
    displayName: Author
  formula.status_icon:
    displayName: ""
  formula.reading_time:
    displayName: "Est. Time"

views:
  - type: cards
    name: "Library"
    order:
      - cover
      - file.name
      - author
      - formula.status_icon
    filters:
      not:
        - 'status == "dropped"'

  - type: table
    name: "Reading List"
    filters:
      and:
        - 'status == "to-read"'
    order:
      - file.name
      - author
      - pages
      - formula.reading_time
\`\`\`

### Daily Notes Index

\`\`\`yaml
filters:
  and:
    - file.inFolder("Daily Notes")
    - '/^\\d{4}-\\d{2}-\\d{2}$/.matches(file.basename)'

formulas:
  word_estimate: '(file.size / 5).round(0)'
  day_of_week: 'date(file.basename).format("dddd")'

properties:
  formula.day_of_week:
    displayName: "Day"
  formula.word_estimate:
    displayName: "~Words"

views:
  - type: table
    name: "Recent Notes"
    limit: 30
    order:
      - file.name
      - formula.day_of_week
      - formula.word_estimate
      - file.mtime
\`\`\`

## Embedding Bases

Embed in Markdown files:

\`\`\`markdown
![[MyBase.base]]

<!-- Specific view -->
![[MyBase.base#View Name]]
\`\`\`

## YAML Quoting Rules

- Use single quotes for formulas containing double quotes: \`'if(done, "Yes", "No")'\`
- Use double quotes for simple strings: \`"My View Name"\`
- Escape nested quotes properly in complex expressions

## Troubleshooting

### YAML Syntax Errors

**Unquoted special characters**: Strings containing \`:\`, \`{\`, \`}\`, \`[\`, \`]\`, \`,\`, \`&\`, \`*\`, \`#\`, \`?\`, \`|\`, \`-\`, \`<\`, \`>\`, \`=\`, \`!\`, \`%\`, \`@\`, \`\\\`\` must be quoted.

\`\`\`yaml
# WRONG - colon in unquoted string
displayName: Status: Active

# CORRECT
displayName: "Status: Active"
\`\`\`

**Mismatched quotes in formulas**: When a formula contains double quotes, wrap the entire formula in single quotes.

\`\`\`yaml
# WRONG - double quotes inside double quotes
formulas:
  label: "if(done, "Yes", "No")"

# CORRECT - single quotes wrapping double quotes
formulas:
  label: 'if(done, "Yes", "No")'
\`\`\`

### Common Formula Errors

**Duration math without field access**: Subtracting dates returns a Duration, not a number. Always access \`.days\`, \`.hours\`, etc.

\`\`\`yaml
# WRONG - Duration is not a number
"(now() - file.ctime).round(0)"

# CORRECT - access .days first, then round
"(now() - file.ctime).days.round(0)"
\`\`\`

**Missing null checks**: Properties may not exist on all notes. Use \`if()\` to guard.

\`\`\`yaml
# WRONG - crashes if due_date is empty
"(date(due_date) - today()).days"

# CORRECT - guard with if()
'if(due_date, (date(due_date) - today()).days, "")'
\`\`\`

**Referencing undefined formulas**: Ensure every \`formula.X\` in \`order\` or \`properties\` has a matching entry in \`formulas\`.

\`\`\`yaml
# This will fail silently if 'total' is not defined in formulas
order:
  - formula.total

# Fix: define it
formulas:
  total: "price * quantity"
\`\`\`

## References

- [Bases Syntax](https://help.obsidian.md/bases/syntax)
- [Functions](https://help.obsidian.md/bases/functions)
- [Views](https://help.obsidian.md/bases/views)
- [Formulas](https://help.obsidian.md/formulas)
`,
};

const JSON_CANVAS: BuiltinSkillDef = {
	id: "json-canvas",
	content: `---
name: json-canvas
description: Create and edit JSON Canvas files (.canvas) with nodes, edges, groups, and connections. Use when working with .canvas files, creating visual canvases, mind maps, flowcharts, or when the user mentions Canvas files in Obsidian.
allowed-tools:
  - obsidian_create_note
  - obsidian_read_note
  - obsidian_modify_note
  - obsidian_search
---

# JSON Canvas Skill

## Tool Usage

To create or edit a canvas file, use these vault tools directly — do NOT call any tool-discovery functions (e.g. \`list_skills\`, \`list_tools\`):

- **Create** a new canvas: call \`obsidian_create_note\` with \`path\` ending in \`.canvas\` and \`content\` as valid JSON.
- **Read** an existing canvas: call \`obsidian_read_note\` with the \`.canvas\` file path.
- **Edit** an existing canvas: call \`obsidian_read_note\` to read it, then call \`obsidian_modify_note\` (or \`obsidian_patch_note\` for targeted edits) to write the updated JSON.
- **Ask permission** before creating or modifying files: briefly describe what you are about to do and proceed only after the user confirms.

## File Structure

A canvas file (\`.canvas\`) contains two top-level arrays following the [JSON Canvas Spec 1.0](https://jsoncanvas.org/spec/1.0/):

\`\`\`json
{
  "nodes": [],
  "edges": []
}
\`\`\`

- \`nodes\` (optional): Array of node objects
- \`edges\` (optional): Array of edge objects connecting nodes

## Common Workflows

### 1. Create a New Canvas

1. Create a \`.canvas\` file with the base structure \`{"nodes": [], "edges": []}\`
2. Generate unique 16-character hex IDs for each node (e.g., \`"6f0ad84f44ce9c17"\`)
3. Add nodes with required fields: \`id\`, \`type\`, \`x\`, \`y\`, \`width\`, \`height\`
4. Add edges referencing valid node IDs via \`fromNode\` and \`toNode\`
5. **Validate**: Parse the JSON to confirm it is valid. Verify all \`fromNode\`/\`toNode\` values exist in the nodes array

### 2. Add a Node to an Existing Canvas

1. Read and parse the existing \`.canvas\` file
2. Generate a unique ID that does not collide with existing node or edge IDs
3. Choose position (\`x\`, \`y\`) that avoids overlapping existing nodes (leave 50-100px spacing)
4. Append the new node object to the \`nodes\` array
5. Optionally add edges connecting the new node to existing nodes
6. **Validate**: Confirm all IDs are unique and all edge references resolve to existing nodes

### 3. Connect Two Nodes

1. Identify the source and target node IDs
2. Generate a unique edge ID
3. Set \`fromNode\` and \`toNode\` to the source and target IDs
4. Optionally set \`fromSide\`/\`toSide\` (top, right, bottom, left) for anchor points
5. Optionally set \`label\` for descriptive text on the edge
6. Append the edge to the \`edges\` array
7. **Validate**: Confirm both \`fromNode\` and \`toNode\` reference existing node IDs

### 4. Edit an Existing Canvas

1. Read and parse the \`.canvas\` file as JSON
2. Locate the target node or edge by \`id\`
3. Modify the desired attributes (text, position, color, etc.)
4. Write the updated JSON back to the file
5. **Validate**: Re-check all ID uniqueness and edge reference integrity after editing

## Nodes

Nodes are objects placed on the canvas. Array order determines z-index: first node = bottom layer, last node = top layer.

### Generic Node Attributes

| Attribute | Required | Type | Description |
|-----------|----------|------|-------------|
| \`id\` | Yes | string | Unique 16-char hex identifier |
| \`type\` | Yes | string | \`text\`, \`file\`, \`link\`, or \`group\` |
| \`x\` | Yes | integer | X position in pixels |
| \`y\` | Yes | integer | Y position in pixels |
| \`width\` | Yes | integer | Width in pixels |
| \`height\` | Yes | integer | Height in pixels |
| \`color\` | No | canvasColor | Preset \`"1"\`-\`"6"\` or hex (e.g., \`"#FF0000"\`) |

### Text Nodes

| Attribute | Required | Type | Description |
|-----------|----------|------|-------------|
| \`text\` | Yes | string | Plain text with Markdown syntax |

\`\`\`json
{
  "id": "6f0ad84f44ce9c17",
  "type": "text",
  "x": 0,
  "y": 0,
  "width": 400,
  "height": 200,
  "text": "# Hello World\\n\\nThis is **Markdown** content."
}
\`\`\`

**Newline pitfall**: Use \`\\n\` for line breaks in JSON strings. Do **not** use the literal \`\\\\n\` — Obsidian renders that as the characters \`\\\` and \`n\`.

### File Nodes

| Attribute | Required | Type | Description |
|-----------|----------|------|-------------|
| \`file\` | Yes | string | Path to file within the system |
| \`subpath\` | No | string | Link to heading or block (starts with \`#\`) |

\`\`\`json
{
  "id": "a1b2c3d4e5f67890",
  "type": "file",
  "x": 500,
  "y": 0,
  "width": 400,
  "height": 300,
  "file": "Attachments/diagram.png"
}
\`\`\`

### Link Nodes

| Attribute | Required | Type | Description |
|-----------|----------|------|-------------|
| \`url\` | Yes | string | External URL |

\`\`\`json
{
  "id": "c3d4e5f678901234",
  "type": "link",
  "x": 1000,
  "y": 0,
  "width": 400,
  "height": 200,
  "url": "https://obsidian.md"
}
\`\`\`

### Group Nodes

Groups are visual containers for organizing other nodes. Position child nodes inside the group's bounds.

| Attribute | Required | Type | Description |
|-----------|----------|------|-------------|
| \`label\` | No | string | Text label for the group |
| \`background\` | No | string | Path to background image |
| \`backgroundStyle\` | No | string | \`cover\`, \`ratio\`, or \`repeat\` |

\`\`\`json
{
  "id": "d4e5f6789012345a",
  "type": "group",
  "x": -50,
  "y": -50,
  "width": 1000,
  "height": 600,
  "label": "Project Overview",
  "color": "4"
}
\`\`\`

## Edges

Edges connect nodes via \`fromNode\` and \`toNode\` IDs.

| Attribute | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| \`id\` | Yes | string | - | Unique identifier |
| \`fromNode\` | Yes | string | - | Source node ID |
| \`fromSide\` | No | string | - | \`top\`, \`right\`, \`bottom\`, or \`left\` |
| \`fromEnd\` | No | string | \`none\` | \`none\` or \`arrow\` |
| \`toNode\` | Yes | string | - | Target node ID |
| \`toSide\` | No | string | - | \`top\`, \`right\`, \`bottom\`, or \`left\` |
| \`toEnd\` | No | string | \`arrow\` | \`none\` or \`arrow\` |
| \`color\` | No | canvasColor | - | Line color |
| \`label\` | No | string | - | Text label |

\`\`\`json
{
  "id": "0123456789abcdef",
  "fromNode": "6f0ad84f44ce9c17",
  "fromSide": "right",
  "toNode": "a1b2c3d4e5f67890",
  "toSide": "left",
  "toEnd": "arrow",
  "label": "leads to"
}
\`\`\`

## Colors

The \`canvasColor\` type accepts either a hex string or a preset number:

| Preset | Color |
|--------|-------|
| \`"1"\` | Red |
| \`"2"\` | Orange |
| \`"3"\` | Yellow |
| \`"4"\` | Green |
| \`"5"\` | Cyan |
| \`"6"\` | Purple |

Preset color values are intentionally undefined — applications use their own brand colors.

## ID Generation

Generate 16-character lowercase hexadecimal strings (64-bit random value):

\`\`\`
"6f0ad84f44ce9c17"
"a3b2c1d0e9f8a7b6"
\`\`\`

## Layout Guidelines

- Coordinates can be negative (canvas extends infinitely)
- \`x\` increases right, \`y\` increases down; position is the top-left corner
- Space nodes 50-100px apart; leave 20-50px padding inside groups
- Align to grid (multiples of 10 or 20) for cleaner layouts

| Node Type | Suggested Width | Suggested Height |
|-----------|-----------------|------------------|
| Small text | 200-300 | 80-150 |
| Medium text | 300-450 | 150-300 |
| Large text | 400-600 | 300-500 |
| File preview | 300-500 | 200-400 |
| Link preview | 250-400 | 100-200 |

## Validation Checklist

After creating or editing a canvas file, verify:

1. All \`id\` values are unique across both nodes and edges
2. Every \`fromNode\` and \`toNode\` references an existing node ID
3. Required fields are present for each node type (\`text\` for text nodes, \`file\` for file nodes, \`url\` for link nodes)
4. \`type\` is one of: \`text\`, \`file\`, \`link\`, \`group\`
5. \`fromSide\`/\`toSide\` values are one of: \`top\`, \`right\`, \`bottom\`, \`left\`
6. \`fromEnd\`/\`toEnd\` values are one of: \`none\`, \`arrow\`
7. Color presets are \`"1"\` through \`"6"\` or valid hex (e.g., \`"#FF0000"\`)
8. JSON is valid and parseable

If validation fails, check for duplicate IDs, dangling edge references, or malformed JSON strings (especially unescaped newlines in text content).

## References

- [JSON Canvas Spec 1.0](https://jsoncanvas.org/spec/1.0/)
- [JSON Canvas GitHub](https://github.com/obsidianmd/jsoncanvas)
`,
};

/** All built-in skills shipped with the plugin. */
export const BUILTIN_SKILLS: BuiltinSkillDef[] = [
	OBSIDIAN_MARKDOWN,
	OBSIDIAN_BASES,
	JSON_CANVAS,
];
