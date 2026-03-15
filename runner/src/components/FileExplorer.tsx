import { useState, useCallback, useRef, useEffect } from 'react';
import {
  ChevronRight, ChevronDown, File, Folder, FolderOpen,
  Plus, FolderPlus, Trash2, Package, Lock, FilePlus,
} from 'lucide-react';
import type { TreeNode, ProjectState } from '../fs/fileSystem';
import { buildTree, getUserFiles, getDependencyFiles } from '../fs/fileSystem';
import SolidityIcon from './icons/SolidityIcon';

function CadenceIcon({ className }: { className?: string }) {
  return (
    <img
      src="https://cadence.flowindex.io/favicon.ico"
      alt="cdc"
      className={className}
      style={{ imageRendering: 'auto' }}
    />
  );
}

interface FileExplorerProps {
  project: ProjectState;
  onOpenFile: (path: string) => void;
  onCreateFile: (path: string) => void;
  onCreateFolder: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onRenameFile: (oldPath: string, newPath: string) => void;
  onMoveFile: (filePath: string, targetFolder: string) => void;
  activeFile: string;
}

/** Inline rename input shown over a file name */
function RenameInput({
  initialValue,
  onSubmit,
  onCancel,
}: {
  initialValue: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Select name without extension
    const dotIdx = initialValue.lastIndexOf('.');
    inputRef.current?.setSelectionRange(0, dotIdx > 0 ? dotIdx : initialValue.length);
  }, [initialValue]);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const trimmed = value.trim();
          if (trimmed && trimmed !== initialValue) onSubmit(trimmed);
          else onCancel();
        }
        if (e.key === 'Escape') onCancel();
        e.stopPropagation();
      }}
      onBlur={() => {
        const trimmed = value.trim();
        if (trimmed && trimmed !== initialValue) onSubmit(trimmed);
        else onCancel();
      }}
      className="bg-zinc-800 text-zinc-200 text-xs rounded px-1 py-0 border border-zinc-500 focus:outline-none focus:border-emerald-500 w-full min-w-0"
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** Inline input for creating a new file inside a folder */
function InlineFolderInput({
  folderPath,
  onSubmit,
  onCancel,
}: {
  folderPath: string;
  onSubmit: (path: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const name = value.trim();
          if (name) {
            const path = name.endsWith('.cdc') || name.endsWith('.sol') ? name : `${name}.cdc`;
            onSubmit(`${folderPath}/${path}`);
          } else {
            onCancel();
          }
        }
        if (e.key === 'Escape') onCancel();
        e.stopPropagation();
      }}
      onBlur={() => {
        const name = value.trim();
        if (name) {
          const path = name.endsWith('.cdc') || name.endsWith('.sol') ? name : `${name}.cdc`;
          onSubmit(`${folderPath}/${path}`);
        } else {
          onCancel();
        }
      }}
      placeholder="filename.cdc or .sol"
      className="bg-zinc-800 text-zinc-200 text-xs rounded px-1 py-0 border border-zinc-500 focus:outline-none focus:border-emerald-500 w-full min-w-0 ml-1"
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function TreeItem({
  node, depth, activeFile, onOpenFile, onDeleteFile, onRenameFile, onMoveFile, onCreateFile,
  renamingPath, setRenamingPath,
  creatingInFolder, setCreatingInFolder,
}: {
  node: TreeNode;
  depth: number;
  activeFile: string;
  onOpenFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onRenameFile: (oldPath: string, newPath: string) => void;
  onMoveFile: (filePath: string, targetFolder: string) => void;
  onCreateFile: (path: string) => void;
  renamingPath: string | null;
  setRenamingPath: (p: string | null) => void;
  creatingInFolder: string | null;
  setCreatingInFolder: (p: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [dragOver, setDragOver] = useState(false);
  const isActive = !node.isFolder && node.path === activeFile;
  const isRenaming = renamingPath === node.path;

  if (node.isFolder) {
    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOver(true);
    };
    const handleDragLeave = () => setDragOver(false);
    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const filePath = e.dataTransfer.getData('text/x-file-path');
      if (filePath && filePath !== node.path) {
        // Don't drop into same folder
        const currentFolder = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
        if (currentFolder !== node.path) {
          onMoveFile(filePath, node.path);
        }
      }
    };

    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`group flex items-center gap-1 w-full px-1 py-0.5 text-left text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 rounded transition-colors ${
            dragOver ? 'bg-emerald-900/30 ring-1 ring-emerald-500/40' : ''
          }`}
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 shrink-0" />
          )}
          {expanded ? (
            <FolderOpen className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
          ) : (
            <Folder className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
          )}
          <span className="truncate flex-1">{node.name}</span>
          {node.readOnly && <Lock className="w-2.5 h-2.5 text-zinc-600 shrink-0" />}
          {!node.readOnly && (
            <span
              className="opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                setCreatingInFolder(node.path);
                setExpanded(true);
              }}
            >
              <FilePlus className="w-3 h-3 text-zinc-600 hover:text-emerald-400" />
            </span>
          )}
        </button>
        {expanded && (
          <>
            {creatingInFolder === node.path && (
              <div
                className="flex items-center gap-1 px-1 py-0.5"
                style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}
              >
                <File className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                <InlineFolderInput
                  folderPath={node.path}
                  onSubmit={(path) => {
                    onCreateFile(path);
                    setCreatingInFolder(null);
                  }}
                  onCancel={() => setCreatingInFolder(null)}
                />
              </div>
            )}
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                activeFile={activeFile}
                onOpenFile={onOpenFile}
                onDeleteFile={onDeleteFile}
                onRenameFile={onRenameFile}
                onMoveFile={onMoveFile}
                onCreateFile={onCreateFile}
                renamingPath={renamingPath}
                setRenamingPath={setRenamingPath}
                creatingInFolder={creatingInFolder}
                setCreatingInFolder={setCreatingInFolder}
              />
            ))}
          </>
        )}
      </div>
    );
  }

  const handleDragStart = (e: React.DragEvent) => {
    if (node.readOnly) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/x-file-path', node.path);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <button
      draggable={!node.readOnly}
      onDragStart={handleDragStart}
      onClick={() => {
        if (!isRenaming) onOpenFile(node.path);
      }}
      onDoubleClick={(e) => {
        if (!node.readOnly) {
          e.preventDefault();
          setRenamingPath(node.path);
        }
      }}
      className={`group flex items-center gap-1 w-full px-1 py-0.5 text-left text-xs rounded transition-colors ${
        isActive
          ? 'bg-zinc-700/60 text-zinc-100'
          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
      }`}
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
    >
      {node.name.endsWith('.cdc') ? (
        <CadenceIcon className="w-3.5 h-3.5 shrink-0" />
      ) : node.name.endsWith('.sol') ? (
        <SolidityIcon className="w-3.5 h-3.5 shrink-0 text-violet-400" />
      ) : (
        <File className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
      )}
      {isRenaming ? (
        <RenameInput
          initialValue={node.name}
          onSubmit={(newName) => {
            // Compute new full path: replace the file name portion
            const dir = node.path.includes('/') ? node.path.substring(0, node.path.lastIndexOf('/')) : '';
            const newPath = dir ? `${dir}/${newName}` : newName;
            onRenameFile(node.path, newPath);
            setRenamingPath(null);
          }}
          onCancel={() => setRenamingPath(null)}
        />
      ) : (
        <span className="truncate flex-1">{node.name}</span>
      )}
      {node.readOnly && !isRenaming && <Lock className="w-2.5 h-2.5 text-zinc-600 shrink-0" />}
      {!node.readOnly && !isRenaming && (
        <span
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteFile(node.path);
          }}
        >
          <Trash2 className="w-3 h-3 text-zinc-600 hover:text-red-400" />
        </span>
      )}
    </button>
  );
}

export default function FileExplorer({
  project,
  onOpenFile,
  onCreateFile,
  onCreateFolder,
  onDeleteFile,
  onRenameFile,
  onMoveFile,
  activeFile,
}: FileExplorerProps) {
  const [newPath, setNewPath] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [createMode, setCreateMode] = useState<'file' | 'folder'>('file');
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [creatingInFolder, setCreatingInFolder] = useState<string | null>(null);

  const userFiles = getUserFiles(project);
  const depFiles = getDependencyFiles(project);

  const userTree = buildTree(userFiles, project.folders);
  const depTree = buildTree(depFiles);

  const handleCreate = useCallback(() => {
    const name = newPath.trim();
    if (!name) return;

    if (createMode === 'folder') {
      onCreateFolder(name);
    } else {
      const path = name.endsWith('.cdc') || name.endsWith('.sol') ? name : `${name}.cdc`;
      onCreateFile(path);
    }

    setNewPath('');
    setShowInput(false);
  }, [newPath, createMode, onCreateFile, onCreateFolder]);

  // Drop on root area = move to root
  const handleRootDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const filePath = e.dataTransfer.getData('text/x-file-path');
    if (filePath && filePath.includes('/')) {
      onMoveFile(filePath, '');
    }
  };

  return (
    <div className="flex flex-col h-full text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Explorer</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setCreateMode('folder');
              setShowInput(true);
            }}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
            title="New folder"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              setCreateMode('file');
              setShowInput(true);
            }}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
            title="New file"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* New item input */}
      {showInput && (
        <div className="px-2 py-1 border-b border-zinc-800">
          <input
            autoFocus
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') { setShowInput(false); setNewPath(''); }
            }}
            onBlur={() => { if (!newPath.trim()) setShowInput(false); }}
            placeholder={createMode === 'folder' ? 'folder/name' : 'filename.cdc or .sol'}
            className="w-full bg-zinc-800 text-zinc-200 text-xs rounded px-2 py-1 border border-zinc-600 focus:outline-none focus:border-zinc-500"
          />
        </div>
      )}

      {/* File tree */}
      <div
        className="flex-1 overflow-y-auto py-1 px-1"
        onDragOver={handleRootDragOver}
        onDrop={handleRootDrop}
      >
        {/* Project files */}
        <div className="mb-2">
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            Files
          </div>
          {userTree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              depth={0}
              activeFile={activeFile}
              onOpenFile={onOpenFile}
              onDeleteFile={onDeleteFile}
              onRenameFile={onRenameFile}
              onMoveFile={onMoveFile}
              onCreateFile={onCreateFile}
              renamingPath={renamingPath}
              setRenamingPath={setRenamingPath}
              creatingInFolder={creatingInFolder}
              setCreatingInFolder={setCreatingInFolder}
            />
          ))}
        </div>

        {/* Dependencies */}
        {depTree.length > 0 && (
          <div className="mt-2 border-t border-zinc-800 pt-2">
            <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              <Package className="w-3 h-3" />
              Dependencies
            </div>
            {depTree.map((node) => (
              <TreeItem
                key={node.path}
                node={node}
                depth={0}
                activeFile={activeFile}
                onOpenFile={onOpenFile}
                onDeleteFile={onDeleteFile}
                onRenameFile={onRenameFile}
                onMoveFile={onMoveFile}
                onCreateFile={onCreateFile}
                renamingPath={renamingPath}
                setRenamingPath={setRenamingPath}
                creatingInFolder={creatingInFolder}
                setCreatingInFolder={setCreatingInFolder}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
