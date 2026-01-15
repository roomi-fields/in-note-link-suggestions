/**
 * Folder selector modal with tree view
 */

import { App, Modal, TFolder } from 'obsidian';

export class FolderSelectorModal extends Modal {
  private selectedFolders: Set<string>;
  private onSubmit: (folders: string[]) => void;
  private treeContainer: HTMLElement | null = null;

  constructor(
    app: App,
    currentFolders: string[],
    onSubmit: (folders: string[]) => void
  ) {
    super(app);
    this.selectedFolders = new Set(currentFolders);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('folder-selector-modal');

    // Title
    contentEl.createEl('h2', { text: 'Select article folders' });

    // Instructions
    contentEl.createEl('p', {
      text: 'Select the folders containing your articles. The plugin will scan these for frontmatter (title, focus_keyword, tags).',
      cls: 'folder-selector-instructions',
    });

    // Tree container
    this.treeContainer = contentEl.createDiv({ cls: 'folder-tree-container' });

    // Build tree from root
    const rootFolder = this.app.vault.getRoot();
    this.renderFolder(this.treeContainer, rootFolder, 0);

    // Buttons
    const buttonContainer = contentEl.createDiv({ cls: 'folder-selector-buttons' });

    const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());

    const submitBtn = buttonContainer.createEl('button', {
      text: 'Confirm',
      cls: 'mod-cta',
    });
    submitBtn.addEventListener('click', () => {
      this.onSubmit(Array.from(this.selectedFolders));
      this.close();
    });
  }

  private renderFolder(container: HTMLElement, folder: TFolder, depth: number): void {
    // Skip hidden folders and root
    if (folder.name.startsWith('.') || folder.name.startsWith('_')) {
      return;
    }

    // Get subfolders
    const subfolders = folder.children
      .filter((child): child is TFolder => child instanceof TFolder)
      .filter(f => !f.name.startsWith('.') && !f.name.startsWith('_'))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Only render if not root, or if root has subfolders
    if (folder.path !== '/') {
      const folderEl = container.createDiv({ cls: 'folder-tree-item' });
      folderEl.style.paddingLeft = `${depth * 20}px`;

      // Checkbox
      const checkbox = folderEl.createEl('input', { type: 'checkbox' });
      checkbox.checked = this.selectedFolders.has(folder.path);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selectedFolders.add(folder.path);
        } else {
          this.selectedFolders.delete(folder.path);
        }
      });

      // Folder icon and name
      const label = folderEl.createEl('label');
      label.createSpan({ cls: 'folder-icon', text: '📁 ' });
      label.createSpan({ text: folder.name });
      label.addEventListener('click', () => {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      });

      // Show article count
      const mdFiles = folder.children.filter(
        child => child instanceof TFolder === false && child.name.endsWith('.md')
      );
      if (mdFiles.length > 0) {
        folderEl.createSpan({
          cls: 'folder-file-count',
          text: ` (${mdFiles.length} files)`,
        });
      }
    }

    // Render subfolders
    for (const subfolder of subfolders) {
      this.renderFolder(container, subfolder, folder.path === '/' ? 0 : depth + 1);
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
