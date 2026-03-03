import { X, Lock } from 'lucide-react';
import type { ProjectState } from '../fs/fileSystem';

interface TabBarProps {
  project: ProjectState;
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  pendingDiffPaths?: string[];
}

function fileName(path: string): string {
  return path.split('/').pop() || path;
}

export default function TabBar({ project, onSelectFile, onCloseFile, pendingDiffPaths = [] }: TabBarProps) {
  if (project.openFiles.length <= 1) return null;

  return (
    <div className="flex items-center border-b border-zinc-700 bg-zinc-900/80 overflow-x-auto shrink-0">
      {project.openFiles.map((path) => {
        const isActive = path === project.activeFile;
        const file = project.files.find((f) => f.path === path);
        const isReadOnly = file?.readOnly;
        const hasDiff = pendingDiffPaths.includes(path);

        return (
          <div
            key={path}
            className={`group flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-r border-zinc-800 shrink-0 transition-colors ${
              isActive
                ? 'bg-zinc-800 text-zinc-100 border-b-2 border-b-emerald-500'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
            }`}
            onClick={() => onSelectFile(path)}
          >
            {isReadOnly && <Lock className="w-2.5 h-2.5 text-zinc-600" />}
            {hasDiff && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
            <span className="truncate max-w-[120px]" title={path}>
              {fileName(path)}
            </span>
            <button
              className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-zinc-300 transition-opacity ml-1"
              onClick={(e) => {
                e.stopPropagation();
                onCloseFile(path);
              }}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
