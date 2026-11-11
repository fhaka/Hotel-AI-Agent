"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * Manages a list of repeatable form rows (FAQs, services, room types).
 * Inputs stay uncontrolled; each row keeps a stable key so React does not
 * mix up values when rows are removed.
 */
export function RepeatableRows<T>({
  initial,
  empty,
  max,
  addLabel,
  renderRow,
}: {
  initial: T[];
  empty: T;
  max: number;
  addLabel: string;
  renderRow: (row: T, index: number, remove: (() => void) | null) => ReactNode;
}) {
  const [state, setState] = useState(() => {
    const rows = (initial.length ? initial : [empty]).map((row, key) => ({ key, row }));
    return { rows, nextKey: rows.length };
  });
  const rows = state.rows;
  const add = () =>
    setState((s) => ({ rows: [...s.rows, { key: s.nextKey, row: empty }], nextKey: s.nextKey + 1 }));
  const remove = (key: number) => setState((s) => ({ ...s, rows: s.rows.filter((r) => r.key !== key) }));

  return (
    <div className="space-y-4">
      {rows.map((r, i) => (
        <div key={r.key}>
          {renderRow(r.row, i, rows.length > 1 ? () => remove(r.key) : null)}
        </div>
      ))}
      {rows.length < max ? (
        <Button type="button" variant="secondary" size="sm" onClick={add}>
          + {addLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function RemoveRowButton({ onClick, label }: { onClick: (() => void) | null; label: string }) {
  if (!onClick) return null;
  return (
    <button type="button" onClick={onClick} className="text-sm font-medium text-danger-700 hover:underline">
      {label}
    </button>
  );
}
