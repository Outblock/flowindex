import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Loader2, ChevronDown } from 'lucide-react'

export interface SearchableSelectOption {
  value: string
  label: string
  sublabel?: string
  icon?: string // URL
}

interface SearchableSelectProps {
  value: string
  onChange: (value: string) => void
  fetchOptions: (query: string) => Promise<SearchableSelectOption[]>
  placeholder?: string
  debounceMs?: number
}

export default function SearchableSelect({
  value,
  onChange,
  fetchOptions,
  placeholder = 'Search...',
  debounceMs = 300,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<SearchableSelectOption[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedLabel, setSelectedLabel] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch options on mount / when opened with empty query
  const doFetch = useCallback(
    async (q: string) => {
      setLoading(true)
      try {
        const results = await fetchOptions(q)
        setOptions(results)
      } catch {
        setOptions([])
      } finally {
        setLoading(false)
      }
    },
    [fetchOptions],
  )

  // Debounced search
  useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      doFetch(query)
    }, debounceMs)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, open, debounceMs, doFetch])

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Resolve label for current value
  useEffect(() => {
    if (!value) {
      setSelectedLabel('')
      return
    }
    // Try to find label in current options
    const match = options.find((o) => o.value === value)
    if (match) {
      setSelectedLabel(match.label)
    }
  }, [value, options])

  // When opening, fetch immediately
  const handleOpen = () => {
    if (!open) {
      setOpen(true)
      setQuery('')
      doFetch('')
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  const handleSelect = (opt: SearchableSelectOption) => {
    onChange(opt.value)
    setSelectedLabel(opt.label)
    setOpen(false)
    setQuery('')
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange('')
    setSelectedLabel('')
    setQuery('')
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={handleOpen}
        className="w-full flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-neutral-800 border border-zinc-300 dark:border-neutral-700 rounded-lg text-sm text-left transition-colors focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25"
      >
        <span className={value ? 'text-zinc-900 dark:text-white' : 'text-zinc-400 dark:text-neutral-500'}>
          {value ? selectedLabel || value : placeholder}
        </span>
        <span className="flex items-center gap-1 ml-2 shrink-0">
          {value && (
            <span
              role="button"
              tabIndex={-1}
              onClick={handleClear}
              className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-neutral-700 text-zinc-400 dark:text-neutral-500"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400 dark:text-neutral-500" />
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-neutral-800 border border-zinc-200 dark:border-neutral-700 rounded-lg shadow-lg overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-zinc-200 dark:border-neutral-700">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full px-2.5 py-1.5 bg-zinc-50 dark:bg-neutral-900 border border-zinc-300 dark:border-neutral-600 rounded-md text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-neutral-500 focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25 transition-colors"
            />
          </div>

          {/* Results */}
          <div className="max-h-48 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-zinc-400 dark:text-neutral-500" />
              </div>
            ) : options.length === 0 ? (
              <div className="py-3 px-3 text-sm text-zinc-400 dark:text-neutral-500 text-center">
                No results found
              </div>
            ) : (
              options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSelect(opt)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-neutral-700 transition-colors ${
                    opt.value === value ? 'bg-zinc-100 dark:bg-neutral-700' : ''
                  }`}
                >
                  {opt.icon && (
                    <img
                      src={opt.icon}
                      alt=""
                      className="w-5 h-5 rounded-full shrink-0 object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-zinc-900 dark:text-white truncate">{opt.label}</div>
                    {opt.sublabel && (
                      <div className="text-xs text-zinc-400 dark:text-neutral-500 truncate">{opt.sublabel}</div>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
