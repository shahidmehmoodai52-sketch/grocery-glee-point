import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { WORLD_CURRENCIES, WORLD_CURRENCIES_MAP } from "@/lib/currencies";

type Props = {
  value: string;
  onChange: (code: string, symbol: string) => void;
  className?: string;
  compact?: boolean;
  placeholder?: string;
};

export function CurrencySelect({ value, onChange, className, compact, placeholder = "Select currency" }: Props) {
  const [open, setOpen] = useState(false);
  const current = WORLD_CURRENCIES_MAP[value];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between font-normal", compact ? "h-9 px-2" : "w-full", className)}
        >
          {current ? (
            <span className="flex items-center gap-2 truncate">
              <span className="font-semibold">{current.symbol}</span>
              <span className="truncate">{current.code}{!compact && ` — ${current.name}`}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command
          filter={(itemValue, search) => {
            const s = search.toLowerCase();
            return itemValue.toLowerCase().includes(s) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search currency…" />
          <CommandList>
            <CommandEmpty>No currency found.</CommandEmpty>
            <CommandGroup>
              {WORLD_CURRENCIES.map((c) => (
                <CommandItem
                  key={c.code}
                  value={`${c.code} ${c.name} ${c.symbol}`}
                  onSelect={() => {
                    onChange(c.code, c.symbol);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === c.code ? "opacity-100" : "opacity-0")} />
                  <span className="w-10 font-semibold">{c.symbol}</span>
                  <span className="w-14 text-xs text-muted-foreground">{c.code}</span>
                  <span className="truncate">{c.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
