import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

interface PathAutocompleteProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Text input that surfaces indexed paths from /api/paths as you type.
 * Debounced (180ms) to avoid hammering the backend on every keystroke;
 * arrow keys move focus through the list, Enter selects or submits.
 *
 * Existing tabs (Risk, Related, History) previously took a raw <input>
 * with a hardcoded placeholder like "e.g. src/payment.ts" — users had
 * to type exact paths blindly. This drop-in replacement is
 * shape-compatible (same props) and degrades cleanly: if the backend
 * /api/paths call fails we just behave like a plain input.
 */
export function PathAutocomplete({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
  className = '',
}: PathAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [hoverIndex, setHoverIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced fetch. We trigger on `value` changes (incl. empty string)
  // because an empty query returns recent-touched paths — useful as a
  // "what's in this repo?" preview before the user types anything.
  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void api
        .paths({ q: value, limit: 12 })
        .then((res) => {
          if (cancelled) return;
          setSuggestions(res.paths);
          setHoverIndex(-1);
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [value, disabled]);

  // Close dropdown when clicking outside.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const pick = (path: string) => {
    onChange(path);
    setOpen(false);
    // Re-focus the input so the user can keep typing/submit
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) {
      if (e.key === 'Enter' && onSubmit) onSubmit();
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
      } else if (onSubmit) {
        onSubmit();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative flex-1">
      <input
        ref={inputRef}
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
        className={`w-full rounded-md border border-gw-border bg-gw-surface px-3 py-2 text-sm gw-mono outline-none focus:border-gw-accent ${className}`}
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
                  // Use onMouseDown so the click registers before the input's
                  // onBlur fires and hides the dropdown.
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
                {highlightMatch(p, value)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Bold the matched substring inside a path so users can scan the dropdown.
 * Falls back to plain text when the query doesn't appear in the path
 * (e.g. the prefix mode showed recent paths).
 */
function highlightMatch(path: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return path;
  const lower = path.toLowerCase();
  const i = lower.indexOf(q.toLowerCase());
  if (i < 0) return path;
  return (
    <>
      {path.slice(0, i)}
      <span className="font-semibold text-gw-text">{path.slice(i, i + q.length)}</span>
      {path.slice(i + q.length)}
    </>
  );
}
