# In-Note Link Suggestions

An Obsidian plugin that suggests relevant internal links within your notes using semantic analysis powered by [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections).

## Features

- **Semantic Matching**: Uses Smart Connections embeddings to find semantically related notes
- **Fine-grained N-gram Analysis**: Analyzes 1-4 word phrases to find the best link insertion points
- **Smart Link Insertion**: Insert links on selected text or at suggested positions
- **Context Preview**: See exactly where each link would be inserted with surrounding context
- **Pagination**: Load suggestions in batches with "More suggestions" button
- **Ignore System**: Hide unwanted suggestions, reset per note
- **Link Removal Tools**: Remove all links or links in selection (preserves image embeds)

## Requirements

- [Obsidian](https://obsidian.md/) v1.0.0 or higher
- [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) plugin installed and configured

## Installation

### From Obsidian Community Plugins (Coming Soon)

1. Open Settings > Community Plugins
2. Search for "In-Note Link Suggestions"
3. Click Install, then Enable

### Manual Installation

1. Download the latest release from [Releases](https://github.com/roomi-fields/in-note-link-suggestions/releases)
2. Extract `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/in-note-link-suggestions/` folder
3. Enable the plugin in Settings > Community Plugins

### Build from Source

```bash
git clone https://github.com/roomi-fields/in-note-link-suggestions.git
cd in-note-link-suggestions
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` to your vault's plugin folder.

## Usage

### Opening the Panel

1. Click the link icon in the left ribbon, or
2. Use the command palette: "In-Note Link Suggestions: Open suggestions panel"

### Working with Suggestions

Each suggestion shows:
- **Target note title**: The note that would be linked
- **Context**: The text where the link would be inserted, with the matched phrase highlighted

**Actions:**
- **Insert [[link]]**: Insert the link at the suggested position
- **Show in note**: Scroll to and highlight the matched text in your note
- **Ignore**: Hide this suggestion (can be reset later)

### Inserting Links on Selected Text

1. Select text in your note
2. Click "Insert [[link]]" on any suggestion
3. The selected text becomes the link display text: `[[Target|selected text]]`

### Loading More Suggestions

- Click "More suggestions" to load 10 additional suggestions
- The button shows how many more suggestions are available
- When exhausted, a notification appears

### Removing Links

- **Remove all links**: Removes all wiki-links and markdown links from the note
- **Remove links in selection**: Removes links only in selected text
- Both options preserve image embeds (`![[image]]`)

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Max suggestions per note | 3 | Maximum link suggestions per target note |
| Max total suggestions | 20 | Initial number of suggestions to display |
| Max candidates | 30 | Number of related notes to analyze from Smart Connections |
| Enable semantic matching | true | Use embedding-based semantic analysis |
| Min semantic similarity | 0.6 | Threshold for semantic matches (0-1, lower = more suggestions) |

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Smart Connections                         │
│              (provides related notes + embeddings)           │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                 In-Note Link Suggestions                     │
│                                                              │
│  1. Get candidate notes from Smart Connections               │
│  2. Extract N-grams (1-4 words) from active note            │
│  3. Embed N-grams using SC's embedding model                │
│  4. Compare N-gram embeddings with candidate embeddings     │
│  5. Rank matches by similarity score                        │
│  6. Display suggestions with context                        │
└─────────────────────────────────────────────────────────────┘
```

### Semantic Matching Process

1. **Candidate Discovery**: Smart Connections identifies notes semantically related to your current note
2. **N-gram Extraction**: The plugin extracts all 1-4 word phrases from your note (excluding frontmatter, code blocks, and existing links)
3. **Embedding Comparison**: Each N-gram is embedded and compared with candidate note embeddings
4. **Ranking**: Matches are ranked by similarity score, with longer N-grams preferred when scores are close
5. **Deduplication**: Overlapping matches are filtered to show only the best option for each position

## Development

### Project Structure

```
in-note-link-suggestions/
├── src/
│   ├── main.ts              # Plugin entry point
│   ├── view.ts              # Sidebar view UI and logic
│   ├── semantic-matcher.ts  # N-gram extraction and embedding comparison
│   ├── compute-suggestions.ts # Lexical matching fallback
│   ├── settings.ts          # Settings tab
│   └── types.ts             # TypeScript interfaces
├── styles.css               # Plugin styles
├── manifest.json            # Obsidian plugin manifest
├── esbuild.config.mjs       # Build configuration
└── package.json
```

### Key Interfaces

```typescript
interface LinkSuggestion {
  blockIndex: number;      // Block containing the match
  blockText: string;       // Full block text
  matchedText: string;     // The matched N-gram
  globalStart: number;     // Start position in note
  globalEnd: number;       // End position in note
  targetTitle: string;     // Target note title
  targetPath: string;      // Target note path
  context: string;         // Display context with match highlighted
}

interface SemanticMatchResult {
  suggestions: LinkSuggestion[];
  totalAvailable: number;  // Total matches above threshold
  hasMore: boolean;        // More suggestions available
}
```

### Building

```bash
# Development build with watch
npm run dev

# Production build
npm run build
```

### Future Improvements

- [ ] Batch insert multiple suggestions
- [ ] Keyboard shortcuts for actions
- [ ] Custom similarity threshold per note
- [ ] Export/import ignored suggestions
- [ ] Integration with other embedding providers

## Troubleshooting

### "Waiting for Smart Connections..."
Smart Connections needs to finish indexing your vault. Wait for it to complete or check its status in its own panel.

### No suggestions appearing
- Ensure Smart Connections has indexed your vault
- Try lowering the "Min semantic similarity" setting
- Check that the current note has related notes in Smart Connections

### Suggestions seem irrelevant
- Increase the "Min semantic similarity" setting
- The quality depends on Smart Connections' embeddings

## License

MIT License - see [LICENSE](LICENSE) file.

## Credits

- Built with [Obsidian Plugin API](https://docs.obsidian.md/)
- Powered by [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) embeddings
- Developed with [Claude Code](https://claude.ai/)

## Support

- [Report issues](https://github.com/roomi-fields/in-note-link-suggestions/issues)
- [Request features](https://github.com/roomi-fields/in-note-link-suggestions/issues/new)
