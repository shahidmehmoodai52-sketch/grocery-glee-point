import * as React from "react";

import { cn } from "@/lib/utils";

const isCalculatorExpression = (value: string) => /[+\-*/%()]/.test(value);

const evaluateCalculatorExpression = (value: string): string | null => {
  const normalized = value
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/,/g, ".")
    .replace(/\s+/g, "");
  if (!isCalculatorExpression(normalized)) return null;
  if (!/^[0-9.+\-*/%()]+$/.test(normalized)) return null;
  try {
    const result = Function(`"use strict"; return (${normalized})`)();
    if (typeof result === "number" && Number.isFinite(result)) {
      return String(result);
    }
  } catch {
    return null;
  }
  return null;
};

const createChangeEvent = (
  event: React.ChangeEvent<HTMLInputElement>,
  value: string,
) => {
  const target = { ...event.target, value } as unknown as EventTarget & { value: string };
  return {
    ...event,
    target,
    currentTarget: target,
  } as React.ChangeEvent<HTMLInputElement>;
};

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onBlur, onKeyDown, onChange, inputMode, ...props }, ref) => {
    const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
      if (type === "number") {
        const value = event.currentTarget.value;
        const evaluated = evaluateCalculatorExpression(value);
        if (evaluated !== null && evaluated !== value) {
          onChange?.(createChangeEvent(event as any, evaluated));
        }
      }
      onBlur?.(event);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (type === "number" && event.key === "Enter") {
        const value = event.currentTarget.value;
        const evaluated = evaluateCalculatorExpression(value);
        if (evaluated !== null && evaluated !== value) {
          onChange?.(createChangeEvent(event as any, evaluated));
        }
      }
      onKeyDown?.(event);
    };

    const renderType = type === "number" ? "text" : type;
    const renderedInputMode = type === "number" ? inputMode ?? "decimal" : inputMode;

    return (
      <input
        type={renderType}
        inputMode={renderedInputMode}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onChange={onChange}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
