"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

export function SearchInput({
  placeholder = "Search...",
  onSearch,
  initialValue = "",
}: {
  placeholder?: string;
  onSearch: (value: string) => void;
  initialValue?: string;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    const timeout = setTimeout(() => onSearch(value), 350);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" size={16} />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-9 pr-3 py-2 rounded-xl border border-cream font-body text-sm focus:outline-none focus:ring-2 focus:ring-gold"
      />
    </div>
  );
}
