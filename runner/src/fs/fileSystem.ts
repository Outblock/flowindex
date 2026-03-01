/** Virtual file system for multi-file Cadence projects.
 * Stores files in localStorage, keyed by project name. */

export interface FileEntry {
  path: string;        // e.g. "main.cdc", "contracts/MyToken.cdc"
  content: string;
  readOnly?: boolean;  // true for dependency files
  language?: string;   // default: 'cadence'
}

export interface ProjectState {
  files: FileEntry[];
  activeFile: string;
  openFiles: string[];
}

const STORAGE_KEY = 'runner:project';

const DEFAULT_CODE = `// Welcome to Cadence Runner
// Press Ctrl/Cmd+Enter to execute

access(all) fun main(): String {
    return "Hello, Flow!"
}
`;

function defaultProject(): ProjectState {
  return {
    files: [{ path: 'main.cdc', content: DEFAULT_CODE }],
    activeFile: 'main.cdc',
    openFiles: ['main.cdc'],
  };
}

export function loadProject(): ProjectState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ProjectState;
      if (parsed.files && parsed.files.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return defaultProject();
}

export function saveProject(state: ProjectState) {
  // Only save non-readOnly files (deps are resolved on demand)
  const toSave: ProjectState = {
    ...state,
    files: state.files.filter((f) => !f.readOnly),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch { /* quota exceeded, ignore */ }
}

export function getFileContent(state: ProjectState, path: string): string | undefined {
  return state.files.find((f) => f.path === path)?.content;
}

export function updateFileContent(state: ProjectState, path: string, content: string): ProjectState {
  return {
    ...state,
    files: state.files.map((f) => (f.path === path ? { ...f, content } : f)),
  };
}

export function createFile(state: ProjectState, path: string, content = ''): ProjectState {
  if (state.files.some((f) => f.path === path)) return state;
  return {
    ...state,
    files: [...state.files, { path, content }],
    openFiles: [...state.openFiles, path],
    activeFile: path,
  };
}

export function deleteFile(state: ProjectState, path: string): ProjectState {
  const files = state.files.filter((f) => f.path !== path);
  const openFiles = state.openFiles.filter((f) => f !== path);
  let activeFile = state.activeFile;
  if (activeFile === path) {
    activeFile = openFiles[0] || files[0]?.path || '';
  }
  return { files, openFiles, activeFile };
}

export function renameFile(state: ProjectState, oldPath: string, newPath: string): ProjectState {
  if (state.files.some((f) => f.path === newPath)) return state;
  return {
    ...state,
    files: state.files.map((f) => (f.path === oldPath ? { ...f, path: newPath } : f)),
    openFiles: state.openFiles.map((f) => (f === oldPath ? newPath : f)),
    activeFile: state.activeFile === oldPath ? newPath : state.activeFile,
  };
}

export function openFile(state: ProjectState, path: string): ProjectState {
  const openFiles = state.openFiles.includes(path) ? state.openFiles : [...state.openFiles, path];
  return { ...state, openFiles, activeFile: path };
}

export function closeFile(state: ProjectState, path: string): ProjectState {
  const openFiles = state.openFiles.filter((f) => f !== path);
  let activeFile = state.activeFile;
  if (activeFile === path) {
    const idx = state.openFiles.indexOf(path);
    activeFile = openFiles[Math.min(idx, openFiles.length - 1)] || '';
  }
  return { ...state, openFiles, activeFile };
}

/** Add a resolved dependency file (read-only, in deps/ folder) */
export function addDependencyFile(state: ProjectState, address: string, contractName: string, code: string): ProjectState {
  const path = `deps/${address}/${contractName}.cdc`;
  const existing = state.files.find((f) => f.path === path);
  if (existing) {
    // Update content if changed
    if (existing.content === code) return state;
    return {
      ...state,
      files: state.files.map((f) => (f.path === path ? { ...f, content: code } : f)),
    };
  }
  return {
    ...state,
    files: [...state.files, { path, content: code, readOnly: true }],
  };
}

/** Get all user files (non-dependency) */
export function getUserFiles(state: ProjectState): FileEntry[] {
  return state.files.filter((f) => !f.readOnly && !f.path.startsWith('deps/'));
}

/** Get all dependency files */
export function getDependencyFiles(state: ProjectState): FileEntry[] {
  return state.files.filter((f) => f.readOnly || f.path.startsWith('deps/'));
}

/** Build a folder tree structure from flat file list */
export interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  readOnly?: boolean;
  children: TreeNode[];
}

export function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join('/');

      if (isFile) {
        current.push({ name, path, isFolder: false, readOnly: file.readOnly, children: [] });
      } else {
        let folder = current.find((n) => n.name === name && n.isFolder);
        if (!folder) {
          folder = { name, path, isFolder: true, readOnly: file.readOnly, children: [] };
          current.push(folder);
        }
        current = folder.children;
      }
    }
  }

  // Sort: folders first, then files, alphabetically
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => { if (n.isFolder) sortNodes(n.children); });
  };
  sortNodes(root);

  return root;
}
