import { useState, useRef, useEffect } from 'react';
import { X, Search, Plus, Trash2, Pencil, Globe, FolderOpen, Clock } from 'lucide-react';
import type { CloudProject } from '../auth/useProjects';
import type { LocalProjectMeta } from '../fs/fileSystem';

interface ProjectItem {
  id: string;
  name: string;
  slug: string;
  network: string;
  is_public: boolean;
  updated_at: string;
  isLocal?: boolean;
}

interface ProjectManagerModalProps {
  open: boolean;
  onClose: () => void;
  cloudProjects: CloudProject[];
  localProjects: LocalProjectMeta[];
  currentProjectId?: string;
  isLoggedIn: boolean;
  currentNetwork: string;
  onSelectProject: (slugOrId: string, isLocal: boolean) => void;
  onNewProject: () => void;
  onRename: (id: string, name: string, isLocal: boolean) => void;
  onDelete: (id: string, isLocal: boolean) => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (isNaN(diff)) return '';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function ProjectManagerModal({
  open,
  onClose,
  cloudProjects,
  localProjects,
  currentProjectId,
  isLoggedIn,
  currentNetwork,
  onSelectProject,
  onNewProject,
  onRename,
  onDelete,
}: ProjectManagerModalProps) {
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus search on open
  useEffect(() => {
    if (open) {
      setSearch('');
      setEditingId(null);
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  // Merge cloud + local into unified list
  const allProjects: ProjectItem[] = [
    ...cloudProjects.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      network: p.network,
      is_public: p.is_public,
      updated_at: p.updated_at,
      isLocal: false,
    })),
    ...localProjects.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.id,
      network: currentNetwork,
      is_public: false,
      updated_at: p.updatedAt,
      isLocal: true,
    })),
  ];

  const filtered = search
    ? allProjects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : allProjects;

  const handleRenameSubmit = (p: ProjectItem) => {
    if (editName.trim() && editName.trim() !== p.name) {
      onRename(p.id, editName.trim(), !!p.isLocal);
    }
    setEditingId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
          <FolderOpen className="w-4 h-4 text-zinc-400" />
          <h2 className="text-sm font-medium text-zinc-200 flex-1">Projects</h2>
          <button
            onClick={() => {
              onNewProject();
              onClose();
            }}
            className="flex items-center gap-1 px-2.5 py-1 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-colors"
          >
            <Plus className="w-3 h-3" />
            New
          </button>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-zinc-800">
          <div className="flex items-center gap-2 bg-zinc-800 rounded-md px-2.5 py-1.5">
            <Search className="w-3.5 h-3.5 text-zinc-500" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects..."
              className="flex-1 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none"
            />
          </div>
        </div>

        {/* Project list */}
        <div className="flex-1 overflow-y-auto px-2 py-1">
          {filtered.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-xs text-zinc-500">
                {search ? 'No projects match your search' : 'No projects yet'}
              </p>
            </div>
          ) : (
            filtered.map((p) => {
              const isCurrent = p.id === currentProjectId;
              const isEditing = editingId === p.id;

              return (
                <div
                  key={p.id}
                  className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                    isCurrent
                      ? 'bg-emerald-900/20 border border-emerald-700/30'
                      : 'hover:bg-zinc-800/60 border border-transparent'
                  }`}
                  onClick={() => {
                    if (!isEditing) {
                      onSelectProject(p.slug, !!p.isLocal);
                      onClose();
                    }
                  }}
                >
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameSubmit(p);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        onBlur={() => handleRenameSubmit(p)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full bg-zinc-800 text-xs text-zinc-200 px-2 py-1 border border-zinc-600 rounded focus:outline-none focus:border-zinc-500"
                      />
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-zinc-200 font-medium truncate">{p.name}</span>
                          {p.is_public && <Globe className="w-3 h-3 text-zinc-500 shrink-0" />}
                          {p.isLocal && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-500">local</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                            p.network === 'mainnet' ? 'bg-emerald-500' : p.network === 'testnet' ? 'bg-amber-500' : 'bg-zinc-500'
                          }`} />
                          <span className="text-[10px] text-zinc-500">{p.network}</span>
                          {p.updated_at && (
                            <>
                              <Clock className="w-2.5 h-2.5 text-zinc-600" />
                              <span className="text-[10px] text-zinc-600">{timeAgo(p.updated_at)}</span>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Actions */}
                  {!isEditing && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => { setEditingId(p.id); setEditName(p.name); }}
                        className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                        title="Rename"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${p.name}"?`)) {
                            onDelete(p.id, !!p.isLocal);
                          }
                        }}
                        className="p-1 text-zinc-500 hover:text-red-400 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {!isLoggedIn && (
          <div className="px-4 py-2 border-t border-zinc-800">
            <p className="text-[10px] text-zinc-600 text-center">
              Sign in to sync projects to the cloud
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
