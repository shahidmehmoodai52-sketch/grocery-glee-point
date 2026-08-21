import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2 } from "lucide-react";

interface TypedConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (reason: string) => Promise<void>;
  requireReason?: boolean;
  destructive?: boolean;
  isLoading?: boolean;
}

export function TypedConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  requireReason = false,
  destructive = false,
  isLoading = false,
}: TypedConfirmDialogProps) {
  const [typedValue, setTypedValue] = useState("");
  const [reason, setReason] = useState("");

  const handleConfirm = async () => {
    if (confirmText && typedValue !== confirmText) return;
    if (requireReason && !reason.trim()) return;
    
    await onConfirm(reason);
    setTypedValue("");
    setReason("");
    onOpenChange(false);
  };

  const isConfirmDisabled = 
    isLoading || 
    (confirmText && typedValue !== confirmText) || 
    (requireReason && !reason.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {destructive && <AlertTriangle className="h-5 w-5 text-destructive" />}
            {title}
          </DialogTitle>
          <DialogDescription className="pt-2">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {confirmText && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Type <span className="font-bold select-all">"{confirmText}"</span> to confirm:
              </Label>
              <Input
                value={typedValue}
                onChange={(e) => setTypedValue(e.target.value)}
                placeholder={confirmText}
                autoComplete="off"
              />
            </div>
          )}

          {requireReason && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Reason for action:</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Non-payment, Violations, Maintenance..."
                autoComplete="off"
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={isConfirmDisabled}
            className="min-w-[100px]"
          >
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
