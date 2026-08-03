import * as React from "react";

import { cn } from "@/lib/utils";

/** True when the text looks like an arithmetic expression (not just a plain/negative number). */
const isCalculatorExpression = (value: string) =>
  /[+*/%()]/.test(value) || /\d\s*-/.test(value);

export const evaluateCalculatorExpression = (value: string): string | null => {
  const normalized = value
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/\s+/g, "");
  if (!normalized) return null;
  if (!isCalculatorExpression(normalized)) return null;
  if (!/^[0-9.+\-*/%()]+$/.test(normalized)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${normalized})`)();
    if (typeof result === "number" && Number.isFinite(result)) {
      return String(Math.round(result * 1e6) / 1e6);
    }
  } catch {
    return null;
  }
  return null;
};

/** Minimal synthetic change event whose target carries the evaluated value. */
const emitValue = (
  el: HTMLInputElement,
  value: string,
  onChange?: React.ChangeEventHandler<HTMLInputElement>,
) => {
  if (!onChange) return;
  const target = { name: el.name, id: el.id, value, type: "number" } as unknown as HTMLInputElement;
  onChange({
    target,
    currentTarget: target,
    bubbles: true,
    cancelable: false,
    defaultPrevented: false,
    isTrusted: false,
    nativeEvent: undefined as any,
    preventDefault() {},
    stopPropagation() {},
    isPropagationStopped: () => false,
    isDefaultPrevented: () => false,
    persist() {},
    eventPhase: 0,
    timeStamp: Date.now(),
    type: "change",
  } as unknown as React.ChangeEvent<HTMLInputElement>);
};

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onBlur, onKeyDown, onChange, inputMode, value, ...props }, ref) => {
    const isNumeric = type === "number";
    // While the user types a formula (e.g. "10+10"), keep the raw text locally so the
    // controlled numeric value doesn't wipe it out.
    const [draft, setDraft] = React.useState<string | null>(null);

    const commit = (el: HTMLInputElement) => {
      const raw = draft ?? el.value;
      const evaluated = evaluateCalculatorExpression(raw);
      if (evaluated !== null) emitValue(el, evaluated, onChange);
      setDraft(null);
    };

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (isNumeric) {
        const raw = event.target.value;
        if (isCalculatorExpression(raw)) {
          setDraft(raw);
          const evaluated = evaluateCalculatorExpression(raw);
          if (evaluated !== null) emitValue(event.target, evaluated, onChange);
          return;
        }
        setDraft(null);
      }
      onChange?.(event);
    };

    const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
      if (isNumeric) commit(event.currentTarget);
      onBlur?.(event);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (isNumeric && event.key === "Enter") commit(event.currentTarget);
      onKeyDown?.(event);
    };

    const renderedValue = isNumeric && draft !== null ? draft : value;

    return (
      <input
        type={isNumeric ? "text" : type}
        inputMode={isNumeric ? (inputMode ?? "decimal") : inputMode}
        value={renderedValue}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onChange={handleChange}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
