import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus, Globe, Trash2, Pencil, Download, Share2, X, Copy, Check, Link } from 'lucide-react';
import type { CloudProject } from '../auth/useProjects';

interface ProjectSelectorProps {
  projects: CloudProject[];
  currentProject: { id?: string; name: string; slug?: string; is_public?: boolean } | null;
  onSelectProject: (slug: string) => void;
  onNewProject: () => void;
  onRename: (id: string, name: string) => void;
  onTogglePublic: (id: string, isPublic: boolean) => void;
  onDelete: (id: string) => void;
  saving: boolean;
  lastSaved: Date | null;
  onExport: () => void;
}

export default function ProjectSelector({
  projects,
  currentProject,
  onSelectProject,
  onNewProject,
  onRename,
  onTogglePublic,
  onDelete,
  saving,
  lastSaved,
  onExport,
}: ProjectSelectorProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [showShareModal, setShowShareModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

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

  // Close modal on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setShowShareModal(false);
        setCopied(false);
      }
    };
    if (showShareModal) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showShareModal]);

  // Close modal on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowShareModal(false); setCopied(false); }
    };
    if (showShareModal) document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [showShareModal]);

  const shareUrl = currentProject?.slug
    ? `${window.location.origin}?project=${currentProject.slug}`
    : '';

  const handleCopyLink = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
                  <button
                    onClick={() => { setShowShareModal(true); setOpen(false); }}
                    className="text-zinc-500 hover:text-zinc-300 p-0.5"
                    title="Share"
                  >
                    <Share2 className="w-3 h-3" />
                  </button>
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

      {/* Share modal */}
      {showShareModal && currentProject?.id && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div
            ref={modalRef}
            className="bg-zinc-800 border border-zinc-700 shadow-2xl w-[380px] rounded-lg"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
              <h3 className="text-sm font-medium text-zinc-200">
                Share "{currentProject.name}"
              </h3>
              <button
                onClick={() => { setShowShareModal(false); setCopied(false); }}
                className="text-zinc-500 hover:text-zinc-300 p-0.5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-4 py-4 space-y-4">
              {/* Public toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className={`w-4 h-4 ${currentProject.is_public ? 'text-emerald-400' : 'text-zinc-500'}`} />
                  <span className="text-xs text-zinc-300">Anyone with the link can view</span>
                </div>
                <button
                  onClick={() => currentProject.id && onTogglePublic(currentProject.id, !currentProject.is_public)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${
                    currentProject.is_public ? 'bg-emerald-600' : 'bg-zinc-600'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      currentProject.is_public ? 'translate-x-4' : ''
                    }`}
                  />
                </button>
              </div>

              {/* Share link (only when public) */}
              {currentProject.is_public && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0 bg-zinc-900 border border-zinc-600 rounded px-2.5 py-1.5">
                      <Link className="w-3 h-3 text-zinc-500 shrink-0" />
                      <span className="text-[11px] text-zinc-400 truncate">{shareUrl}</span>
                    </div>
                    <button
                      onClick={handleCopyLink}
                      className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium rounded transition-colors shrink-0 ${
                        copied
                          ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-600/30'
                          : 'bg-blue-600 hover:bg-blue-500 text-white'
                      }`}
                    >
                      {copied ? (
                        <><Check className="w-3 h-3" /> Copied</>
                      ) : (
                        <><Copy className="w-3 h-3" /> Copy</>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {!currentProject.is_public && (
                <p className="text-[11px] text-zinc-500">
                  Enable public access to generate a shareable link.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
