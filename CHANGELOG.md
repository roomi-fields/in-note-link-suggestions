# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2024-12-11

### Added

- Initial release
- **Semantic Matching**: Fine-grained N-gram analysis (1-4 words) using Smart Connections embeddings
- **Sidebar Panel**: Dedicated view showing link suggestions with context preview
- **Link Insertion**:
  - Insert at suggested position
  - Insert on selected text with custom display text
- **Navigation**: "Show in note" scrolls to matched text with paragraph context
- **Ignore System**:
  - Ignore individual suggestions
  - Reset ignored suggestions per note
  - Persistent storage of ignored suggestions
- **Pagination**:
  - Load initial suggestions based on settings
  - "More suggestions" button to load additional matches
  - Loading indicator during fetch
  - Notification when no more suggestions available
- **Link Removal Tools**:
  - Remove all links in note
  - Remove links in selection only
  - Preserves image embeds (`![[image]]`)
  - Preserves frontmatter
- **Settings Panel**:
  - Max suggestions per target note
  - Max total suggestions (initial load)
  - Max candidates from Smart Connections
  - Enable/disable semantic matching
  - Minimum similarity threshold
- **Smart Features**:
  - Automatic position adjustment after insertions
  - Debounced refresh on file change
  - Non-blocking Smart Connections initialization
  - Selection tracking via DOM events

### Technical Details

- Built with TypeScript and esbuild
- Uses Smart Connections' `embed_model.embed_batch()` for N-gram embeddings
- Cosine similarity for semantic comparison
- Supports Obsidian's CodeMirror 6 editor

## [Unreleased]

### Planned

- Batch insert multiple suggestions
- Keyboard shortcuts
- Custom similarity threshold per note
- Export/import ignored suggestions
