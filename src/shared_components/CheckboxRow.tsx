export interface CheckboxRowProps {
  /** The wording beside the box. Our own copy, never model-authored text. */
  readonly label: string;
  readonly checked: boolean;
  /** Called with no argument: the caller already knows which row this is. */
  readonly onToggle: () => void;
}

/** A checkbox and its label, as the dislike-reason list draws them. */
export function CheckboxRow({ label, checked, onToggle }: CheckboxRowProps) {
  return (
    <label className="flex items-center gap-2 text-label dark:text-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="size-4 accent-rose-500"
      />
      {label}
    </label>
  );
}
