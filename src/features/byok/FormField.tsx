import type { ReactNode } from 'react';

export interface FormFieldProps {
  /** Visible label text, which also names the control for assistive tech. */
  readonly label: string;
  /**
   * The `<select>` or `<input>`. Give it {@link FIELD_CONTROL} as its
   * `className` — Tailwind only generates class names it can read whole, so
   * the string cannot be handed down as a prop and applied here.
   */
  readonly children: ReactNode;
}

/**
 * The chrome every BYOK control wears: a stacked label above the control.
 *
 * The label wraps the control rather than pointing at it by id, so the two
 * are associated without inventing an id per field.
 */
export const FIELD_CONTROL =
  'rounded-lg border border-hairline bg-panel px-2 py-1 dark:border-slate-700 dark:bg-slate-900';

/** A labelled form control in the BYOK panel's row. */
export function FormField({ label, children }: FormFieldProps) {
  return (
    <label className="flex flex-col text-label dark:text-slate-300">
      {label}
      {children}
    </label>
  );
}
