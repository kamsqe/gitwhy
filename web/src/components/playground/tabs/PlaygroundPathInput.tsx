import { useEffect, useRef, useState } from 'react';
import type { PlaygroundApi } from '../lib/playgroundApi';

interface PlaygroundPathInputProps {
  api: PlaygroundApi;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Client-side autocomplete: queries indexed paths from the in-memory
 * DB instead of /api/paths. Same UX as the local-app autocomplete.
 *
 * Synchronous queries are cheap (single SQLite call), so we run on
 * every keystroke without debouncing — feels instant.
 */
export function PlaygroundPathInput({
  api,
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
}: PlaygroundPathInputProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [hoverIndex, setHoverIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) return;
    try {
      const { paths } = api.paths({ q: value, limit: 12 });
      setSuggestions(paths);
      setHoverIndex(-1);
    } catch {
      setSuggestions([]);
    }
  }, [api, value, disabled]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const pick = (path: string): void => {
    onChange(path);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!open || suggestions.length === 0) {
      if (e.key === 'Enter') onSubmit();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHoverIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHoverIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      if (hoverIndex >= 0) {
        e.preventDefault();
        pick(suggestions[hoverIndex] ?? '');
      } else {
        onSubmit();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative flex-1">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-md border border-gw-border bg-gw-surface px-3 py-2 text-sm gw-mono outline-none focus:border-gw-accent"
      />
      {open && suggestions.length > 0 && (
        <ul
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-gw-border bg-gw-surface shadow-lg"
          role="listbox"
        >
          {suggestions.map((p, i) => (
            <li key={p}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                onMouseEnter={() => setHoverIndex(i)}
                className={`block w-full truncate px-3 py-1.5 text-left text-sm gw-mono transition-colors ${
                  i === hoverIndex
                    ? 'bg-gw-accent/15 text-gw-text'
                    : 'text-gw-text-dim hover:bg-gw-surface-2'
                }`}
                title={p}
              >
                {p}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
