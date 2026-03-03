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
  folders: string[]; // e.g. "contracts", "contracts/interfaces"
}

const STORAGE_KEY = 'runner:project';

export const DEFAULT_CODE = `// Welcome to Cadence Runner
// Press Ctrl/Cmd+Enter to execute

access(all) fun main(): String {
    return "Hello, Flow!"
}
`;

export interface Template {
  label: string;
  description: string;
  icon: string;
  files: FileEntry[];
  activeFile: string;
  folders?: string[];
}

export const TEMPLATES: Template[] = [
  {
    label: 'Hello World',
    description: 'Simple script that returns a string',
    icon: 'wave',
    files: [{ path: 'main.cdc', content: DEFAULT_CODE }],
    activeFile: 'main.cdc',
  },
  {
    label: 'Query Account Balance',
    description: 'Check FLOW balance of any address',
    icon: 'search',
    files: [{
      path: 'main.cdc',
      content: `import FungibleToken from 0xf233dcee88fe0abe
import FlowToken from 0x1654653399040a61

access(all) fun main(address: Address): UFix64 {
    let account = getAccount(address)
    let vaultRef = account.capabilities
        .borrow<&{FungibleToken.Balance}>(/public/flowTokenBalance)
        ?? panic("Could not borrow Balance capability")
    return vaultRef.balance
}
`,
    }],
    activeFile: 'main.cdc',
  },
  {
    label: 'Query NFT Collection',
    description: 'List NFT IDs in a collection',
    icon: 'image',
    files: [{
      path: 'main.cdc',
      content: `import NonFungibleToken from 0x1d7e57aa55817448

access(all) fun main(address: Address, storagePath: String): [UInt64] {
    let account = getAuthAccount<auth(Storage) &Account>(address)
    let path = StoragePath(identifier: storagePath)
        ?? panic("Invalid storage path")
    if let collection = account.storage.borrow<&{NonFungibleToken.Collection}>(from: path) {
        return collection.getIDs()
    }
    return []
}
`,
    }],
    activeFile: 'main.cdc',
  },
  {
    label: 'Create Fungible Token',
    description: 'Define a basic FT contract',
    icon: 'coins',
    files: [{
      path: 'MyToken.cdc',
      content: `import FungibleToken from 0xf233dcee88fe0abe

access(all) contract MyToken: FungibleToken {

    access(all) var totalSupply: UFix64

    access(all) entitlement Withdraw

    access(all) resource Vault: FungibleToken.Vault {
        access(all) var balance: UFix64

        init(balance: UFix64) {
            self.balance = balance
        }

        access(FungibleToken.Withdraw) fun withdraw(amount: UFix64): @{FungibleToken.Vault} {
            self.balance = self.balance - amount
            return <- create Vault(balance: amount)
        }

        access(all) fun deposit(from: @{FungibleToken.Vault}) {
            let vault <- from as! @MyToken.Vault
            self.balance = self.balance + vault.balance
            vault.balance = 0.0
            destroy vault
        }

        access(all) fun createEmptyVault(): @{FungibleToken.Vault} {
            return <- create Vault(balance: 0.0)
        }

        access(all) view fun isAvailableToWithdraw(amount: UFix64): Bool {
            return self.balance >= amount
        }
    }

    access(all) fun createEmptyVault(vaultType: Type): @{FungibleToken.Vault} {
        return <- create Vault(balance: 0.0)
    }

    init() {
        self.totalSupply = 1000000.0
    }
}
`,
    }],
    activeFile: 'MyToken.cdc',
  },
  {
    label: 'Create NFT Collection',
    description: 'Define a basic NFT contract',
    icon: 'image-plus',
    files: [{
      path: 'MyNFT.cdc',
      content: `import NonFungibleToken from 0x1d7e57aa55817448
import MetadataViews from 0x1d7e57aa55817448

access(all) contract MyNFT: NonFungibleToken {

    access(all) var totalSupply: UInt64

    access(all) event ContractInitialized()
    access(all) event Withdraw(id: UInt64, from: Address?)
    access(all) event Deposit(id: UInt64, to: Address?)

    access(all) resource NFT: NonFungibleToken.NFT {
        access(all) let id: UInt64
        access(all) let name: String
        access(all) let description: String
        access(all) let thumbnail: String

        init(name: String, description: String, thumbnail: String) {
            self.id = MyNFT.totalSupply
            self.name = name
            self.description = description
            self.thumbnail = thumbnail
            MyNFT.totalSupply = MyNFT.totalSupply + 1
        }

        access(all) fun createEmptyCollection(): @{NonFungibleToken.Collection} {
            return <- MyNFT.createEmptyCollection(nftType: Type<@MyNFT.NFT>())
        }

        access(all) view fun getViews(): [Type] {
            return [Type<MetadataViews.Display>()]
        }

        access(all) fun resolveView(_ view: Type): AnyStruct? {
            switch view {
                case Type<MetadataViews.Display>():
                    return MetadataViews.Display(
                        name: self.name,
                        description: self.description,
                        thumbnail: MetadataViews.HTTPFile(url: self.thumbnail)
                    )
            }
            return nil
        }
    }

    access(all) resource Collection: NonFungibleToken.Collection {
        access(all) var ownedNFTs: @{UInt64: {NonFungibleToken.NFT}}

        init() {
            self.ownedNFTs <- {}
        }

        access(all) view fun getIDs(): [UInt64] {
            return self.ownedNFTs.keys
        }

        access(all) view fun borrowNFT(_ id: UInt64): &{NonFungibleToken.NFT}? {
            return &self.ownedNFTs[id]
        }

        access(NonFungibleToken.Withdraw) fun withdraw(withdrawID: UInt64): @{NonFungibleToken.NFT} {
            let token <- self.ownedNFTs.remove(key: withdrawID)
                ?? panic("NFT not found in collection")
            return <- token
        }

        access(all) fun deposit(token: @{NonFungibleToken.NFT}) {
            let nft <- token as! @MyNFT.NFT
            self.ownedNFTs[nft.id] <-! nft
        }

        access(all) fun createEmptyCollection(): @{NonFungibleToken.Collection} {
            return <- create Collection()
        }

        access(all) view fun getSupportedNFTTypes(): {Type: Bool} {
            return { Type<@MyNFT.NFT>(): true }
        }

        access(all) view fun isSupportedNFTType(type: Type): Bool {
            return type == Type<@MyNFT.NFT>()
        }
    }

    access(all) fun createEmptyCollection(nftType: Type): @{NonFungibleToken.Collection} {
        return <- create Collection()
    }

    init() {
        self.totalSupply = 0
        emit ContractInitialized()
    }
}
`,
    }],
    activeFile: 'MyNFT.cdc',
  },
  {
    label: 'Send FLOW Transaction',
    description: 'Transfer FLOW tokens to another address',
    icon: 'send',
    files: [{
      path: 'main.cdc',
      content: `import FungibleToken from 0xf233dcee88fe0abe
import FlowToken from 0x1654653399040a61

transaction(amount: UFix64, recipient: Address) {

    let sentVault: @{FungibleToken.Vault}

    prepare(signer: auth(BorrowValue) &Account) {
        let vaultRef = signer.storage
            .borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(from: /storage/flowTokenVault)
            ?? panic("Could not borrow reference to the owner's Vault")
        self.sentVault <- vaultRef.withdraw(amount: amount)
    }

    execute {
        let receiverRef = getAccount(recipient)
            .capabilities.borrow<&{FungibleToken.Receiver}>(/public/flowTokenReceiver)
            ?? panic("Could not borrow receiver reference")
        receiverRef.deposit(from: <- self.sentVault)
    }
}
`,
    }],
    activeFile: 'main.cdc',
  },
];

function defaultProject(): ProjectState {
  return {
    files: [{ path: 'main.cdc', content: DEFAULT_CODE }],
    activeFile: 'main.cdc',
    openFiles: ['main.cdc'],
    folders: [],
  };
}

function normalizeBasePath(path: string): string {
  return path
    .trim()
    .replace(/^\.\//, '')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/');
}

function isInvalidUserPath(path: string): boolean {
  return !path || path.startsWith('/') || path.includes('..') || path.startsWith('deps/');
}

function normalizeFilePath(path: string): string | null {
  const normalized = normalizeBasePath(path).replace(/\/+$/, '');
  if (isInvalidUserPath(normalized)) return null;
  return normalized;
}

function normalizeFolderPath(path: string): string | null {
  const normalized = normalizeBasePath(path).replace(/\/+$/, '');
  if (isInvalidUserPath(normalized)) return null;
  return normalized;
}

function getParentFolders(path: string): string[] {
  const parts = path.split('/');
  const parents: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    parents.push(parts.slice(0, i).join('/'));
  }
  return parents;
}

function sanitizeProject(parsed: Partial<ProjectState>): ProjectState {
  const files = Array.isArray(parsed.files)
    ? parsed.files.filter((f): f is FileEntry => {
        return !!f && typeof f.path === 'string' && typeof f.content === 'string';
      })
    : [];

  if (files.length === 0) return defaultProject();

  const validPaths = new Set(files.map((f) => f.path));
  const activeFile = typeof parsed.activeFile === 'string' && validPaths.has(parsed.activeFile)
    ? parsed.activeFile
    : files[0].path;

  const openFilesRaw = Array.isArray(parsed.openFiles)
    ? parsed.openFiles.filter((p): p is string => typeof p === 'string' && validPaths.has(p))
    : [];
  const openFiles = openFilesRaw.length > 0
    ? Array.from(new Set(openFilesRaw))
    : [activeFile];

  const persistedFolders = Array.isArray(parsed.folders)
    ? parsed.folders
        .map((folder) => normalizeFolderPath(String(folder)))
        .filter((folder): folder is string => !!folder)
    : [];

  return {
    files,
    activeFile,
    openFiles: openFiles.includes(activeFile) ? openFiles : [...openFiles, activeFile],
    folders: Array.from(new Set(persistedFolders)).sort(),
  };
}

export function loadProject(): ProjectState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ProjectState>;
      return sanitizeProject(parsed);
    }
  } catch { /* ignore */ }
  return defaultProject();
}

export function saveProject(state: ProjectState) {
  // Only save non-readOnly files (deps are resolved on demand)
  const toSave: ProjectState = {
    ...state,
    files: state.files.filter((f) => !f.readOnly),
    folders: (state.folders || [])
      .map((folder) => normalizeFolderPath(folder))
      .filter((folder): folder is string => !!folder),
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
  const normalizedPath = normalizeFilePath(path);
  if (!normalizedPath) return state;
  if (state.files.some((f) => f.path === normalizedPath)) return state;

  const folderSet = new Set(state.folders || []);
  for (const folder of getParentFolders(normalizedPath)) {
    folderSet.add(folder);
  }

  return {
    ...state,
    files: [...state.files, { path: normalizedPath, content }],
    openFiles: [...state.openFiles, normalizedPath],
    activeFile: normalizedPath,
    folders: Array.from(folderSet).sort(),
  };
}

export function createFolder(state: ProjectState, path: string): ProjectState {
  const normalizedFolder = normalizeFolderPath(path);
  if (!normalizedFolder) return state;

  const folderSet = new Set(state.folders || []);
  for (const folder of getParentFolders(`${normalizedFolder}/__placeholder__`)) {
    if (folder.endsWith('/__placeholder__')) continue;
    folderSet.add(folder);
  }
  folderSet.add(normalizedFolder);

  return {
    ...state,
    folders: Array.from(folderSet).sort(),
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

function ensureFolderPath(root: TreeNode[], folderPath: string, readOnly = false): void {
  const parts = folderPath.split('/').filter(Boolean);
  let current = root;

  for (let i = 0; i < parts.length; i += 1) {
    const name = parts[i];
    const path = parts.slice(0, i + 1).join('/');
    let folder = current.find((node) => node.isFolder && node.path === path);
    if (!folder) {
      folder = { name, path, isFolder: true, readOnly, children: [] };
      current.push(folder);
    } else if (!readOnly) {
      folder.readOnly = false;
    }
    current = folder.children;
  }
}

export function buildTree(files: FileEntry[], folders: string[] = []): TreeNode[] {
  const root: TreeNode[] = [];

  for (const folderPath of folders) {
    const normalized = normalizeFolderPath(folderPath);
    if (!normalized) continue;
    ensureFolderPath(root, normalized, false);
  }

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    const parent = parts.slice(0, -1).join('/');
    if (parent) {
      ensureFolderPath(root, parent, !!file.readOnly);
    }

    let current = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const folderPath = parts.slice(0, i + 1).join('/');
      const folder = current.find((node) => node.isFolder && node.path === folderPath);
      if (!folder) break;
      current = folder.children;
    }

    const fileName = parts[parts.length - 1];
    const existingFile = current.find((node) => !node.isFolder && node.path === file.path);
    if (!existingFile) {
      current.push({ name: fileName, path: file.path, isFolder: false, readOnly: file.readOnly, children: [] });
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
