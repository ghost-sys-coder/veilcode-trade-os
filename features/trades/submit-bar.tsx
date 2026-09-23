"use client";

import { Save } from "lucide-react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

interface SubmitBarProps { editing: boolean; canSaveDraft: boolean }

export function SubmitBar({ editing, canSaveDraft }: SubmitBarProps) {
  const { pending } = useFormStatus();
  return (
    <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-xl border border-border/80 bg-card/95 p-4 shadow-xl backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-sm font-semibold">{editing ? "Update this trade record" : "Create the canonical trade record"}</p><p className="text-xs text-muted-foreground">Save a draft at any time; lifecycle validation applies when progressing the trade.</p></div>
      <div className="flex gap-2">
        {canSaveDraft ? <Button type="submit" name="intent" value="draft" variant="outline" disabled={pending}>Save draft</Button> : null}
        <Button type="submit" name="intent" value="save" disabled={pending}><Save /> {pending ? "Saving…" : "Save trade"}</Button>
      </div>
    </div>
  );
}
