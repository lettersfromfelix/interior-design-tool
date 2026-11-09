import type { KeyboardEvent } from "react";

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * A number input that commits on Enter or when it loses focus, and reverts on Esc.
 * It shows the current value again whenever that changes (e.g. while the item is dragged).
 */
export function NumberField(props: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  title?: string;
}) {
  const { label, value, onCommit, unit, min, max, step = 1, disabled, title } = props;
  const shown = round1(value);
  const commit = (input: HTMLInputElement) => {
    const v = input.valueAsNumber;
    if (!Number.isFinite(v)) {
      input.value = String(shown);
      return;
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    if (round1(clamped) !== shown) onCommit(clamped);
    else input.value = String(shown);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    else if (e.key === "Escape") {
      e.stopPropagation(); // don't clear the selection
      e.currentTarget.value = String(shown);
      e.currentTarget.blur();
    }
  };
  return (
    <label className="field" title={title}>
      <span className="field__label">{label}</span>
      <input
        key={shown}
        type="number"
        defaultValue={shown}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onBlur={(e) => commit(e.currentTarget)}
        onKeyDown={onKeyDown}
      />
      {unit && <span className="field__unit">{unit}</span>}
    </label>
  );
}
