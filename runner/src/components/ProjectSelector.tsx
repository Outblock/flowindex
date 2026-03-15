import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus, Globe, Trash2, Pencil, Download, Share2, Import } from 'lucide-react';
import type { CloudProject } from '../auth/useProjects';

interface ProjectSelectorProps {
  projects: CloudProject[];
  currentProject: { id?: string; name: string; slug?: string; is_public?: boolean } | null;
  onSelectProject: (slug: string) => void;
  onNewProject: () => void;
  onImportFromAddress: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onShare?: () => void;
  saving: boolean;
  lastSaved: Date | null;
  onExport: () => void;
}

export default function ProjectSelector({
  projects,
  currentProject,
  onSelectProject,
  onNewProject,
  onImportFromAddress,
  onRename,
  onDelete,
  onShare,
  saving,
  lastSaved,
  onExport,
}: ProjectSelectorProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleRenameSubmit = () => {
    if (currentProject?.id && editName.trim()) {
      onRename(currentProject.id, editName.trim());
    }
    setEditing(false);
  };

  return (
    <div ref={dropdownRef} className="relative">
      {/* Current project button */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
      >
        <span className="truncate flex-1 text-left font-medium">
          {currentProject?.name || 'Local Project'}
        </span>
        {saving && <span className="text-[9px] text-amber-400">Saving...</span>}
        {!saving && lastSaved && <span className="text-[9px] text-zinc-600">Saved</span>}
        <ChevronDown className={`w-3 h-3 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 top-full w-64 mt-0.5 bg-zinc-800 border border-zinc-700 shadow-xl z-50 max-h-80 overflow-y-auto">
          {/* Current project actions */}
          {currentProject?.id && (
            <div className="px-2 py-1.5 border-b border-zinc-700 flex items-center gap-1">
              {editing ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameSubmit();
                    if (e.key === 'Escape') setEditing(false);
                  }}
                  onBlur={handleRenameSubmit}
                  className="flex-1 bg-zinc-900 text-xs text-zinc-200 px-1.5 py-0.5 border border-zinc-600 focus:outline-none"
                />
              ) : (
                <>
                  <button
                    onClick={() => { setEditing(true); setEditName(currentProject.name); }}
                    className="text-zinc-500 hover:text-zinc-300 p-0.5"
                    title="Rename"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  {onShare && (
                    <button
                      onClick={() => { onShare(); setOpen(false); }}
                      className="text-zinc-500 hover:text-zinc-300 p-0.5"
                      title="Share"
                    >
                      <Share2 className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    onClick={() => { onExport(); setOpen(false); }}
                    className="text-zinc-500 hover:text-zinc-300 p-0.5"
                    title="Export as ZIP"
                  >
                    <Download className="w-3 h-3" />
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => {
                      if (currentProject.id && confirm('Delete this project?')) {
                        onDelete(currentProject.id);
                        setOpen(false);
                      }
                    }}
                    className="text-zinc-500 hover:text-red-400 p-0.5"
                    title="Delete project"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          )}

          {/* New project */}
          <button
            onClick={() => { onNewProject(); setOpen(false); }}
            className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors"
          >
            <Plus className="w-3 h-3" />
            New Project
          </button>
          <button
            onClick={() => { onImportFromAddress(); setOpen(false); }}
            className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors"
          >
            <Import className="w-3 h-3" />
            Import from Address
          </button>

          {projects.length > 0 && <div className="border-t border-zinc-700" />}

          {/* Project list */}
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => { onSelectProject(p.slug); setOpen(false); }}
              className={`flex items-center gap-2 w-full px-3 py-2 text-xs transition-colors ${
                p.id === currentProject?.id
                  ? 'bg-zinc-700/50 text-zinc-200'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/30'
              }`}
            >
              <span className="truncate flex-1 text-left">{p.name}</span>
              <span className="text-[9px] text-zinc-600 shrink-0">{p.network}</span>
              {p.is_public && <Globe className="w-2.5 h-2.5 text-zinc-600 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
