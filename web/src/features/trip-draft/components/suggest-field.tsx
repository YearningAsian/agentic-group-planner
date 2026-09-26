"use client";

/**
 * Type-ahead list used by the profile home address and the questionnaire destination.
 */
export function SuggestField<T>({
  label,
  value,
  onChange,
  suggestions,
  loading = false,
  onSelect,
  placeholder,
  getKey,
  getLabel,
  getHint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: T[];
  loading?: boolean;
  onSelect: (item: T) => void;
  placeholder: string;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  getHint?: (item: T) => string | undefined;
}) {
  return (
    <div className="relative">
      <label className="block">
        <span className="sr-only">{label}</span>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls="suggest-field-list"
          aria-autocomplete="list"
          className="h-14 w-full rounded-xl border border-[#b0b0b0] px-4 text-[16px] outline-none focus:border-ink"
        />
      </label>
      {loading ? <p className="mt-2 text-[13px] text-muted">Searching…</p> : null}
      {suggestions.length > 0 ? (
        <ul
          id="suggest-field-list"
          role="listbox"
          className="mt-2 max-h-56 overflow-auto rounded-xl border border-line bg-surface"
        >
          {suggestions.map((item) => (
            <li key={getKey(item)}>
              <button
                type="button"
                role="option"
                className="flex w-full flex-col items-start px-4 py-3 text-left hover:bg-bg-muted"
                onClick={() => onSelect(item)}
              >
                <span className="text-[15px] font-medium text-ink">{getLabel(item)}</span>
                {getHint?.(item) ? <span className="text-[13px] text-muted">{getHint(item)}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
