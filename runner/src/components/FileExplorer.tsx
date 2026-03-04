import { useState, useCallback } from 'react';
import {
  ChevronRight, ChevronDown, File, FileCode2, Folder, FolderOpen,
  Plus, FolderPlus, Trash2, Package, Lock,
} from 'lucide-react';
import type { TreeNode, ProjectState } from '../fs/fileSystem';
import { buildTree, getUserFiles, getDependencyFiles } from '../fs/fileSystem';

interface FileExplorerProps {
  project: ProjectState;
  onOpenFile: (path: string) => void;
  onCreateFile: (path: string) => void;
  onCreateFolder: (path: string) => void;
  onDeleteFile: (path: string) => void;
  activeFile: string;
}

function TreeItem({
  node, depth, activeFile, onOpenFile, onDeleteFile,
}: {
  node: TreeNode;
  depth: number;
  activeFile: string;
  onOpenFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isActive = !node.isFolder && node.path === activeFile;

  if (node.isFolder) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 w-full px-1 py-0.5 text-left text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 rounded transition-colors"
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
          <span className="truncate">{node.name}</span>
          {node.readOnly && <Lock className="w-2.5 h-2.5 text-zinc-600 shrink-0" />}
        </button>
        {expanded && node.children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            activeFile={activeFile}
            onOpenFile={onOpenFile}
            onDeleteFile={onDeleteFile}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onOpenFile(node.path)}
      className={`group flex items-center gap-1 w-full px-1 py-0.5 text-left text-xs rounded transition-colors ${
        isActive
          ? 'bg-zinc-700/60 text-zinc-100'
          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
      }`}
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
    >
      {node.name.endsWith('.sol') ? (
        <FileCode2 className="w-3.5 h-3.5 shrink-0 text-blue-400" />
      ) : node.name.endsWith('.cdc') ? (
        <File className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
      ) : (
        <File className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
      )}
      <span className="truncate flex-1">{node.name}</span>
      {node.readOnly && <Lock className="w-2.5 h-2.5 text-zinc-600 shrink-0" />}
      {!node.readOnly && (
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
  activeFile,
}: FileExplorerProps) {
  const [newPath, setNewPath] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [createMode, setCreateMode] = useState<'file' | 'folder'>('file');

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
      const path = (name.endsWith('.cdc') || name.endsWith('.sol')) ? name : `${name}.cdc`;
      onCreateFile(path);
    }

    setNewPath('');
    setShowInput(false);
  }, [newPath, createMode, onCreateFile, onCreateFolder]);

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
            placeholder={createMode === 'folder' ? 'folder/name' : 'filename.cdc'}
            className="w-full bg-zinc-800 text-zinc-200 text-xs rounded px-2 py-1 border border-zinc-600 focus:outline-none focus:border-zinc-500"
          />
        </div>
      )}

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-1 px-1">
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
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
