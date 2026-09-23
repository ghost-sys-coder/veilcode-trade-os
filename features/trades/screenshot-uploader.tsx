"use client";

import { useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/features/trades/select-field";
import { TradeSection } from "@/features/trades/trade-section";
import { screenshotMetadataSchema } from "@/domain/validation/schemas";
import { createClient } from "@/lib/supabase/client";
import { SCREENSHOT_CATEGORIES, TIMEFRAMES } from "@/types/domain";
import type { TradeScreenshotRow } from "@/types/database-helpers";

interface ScreenshotUploaderProps {
  tradeId?: string;
  userId: string;
  screenshots: TradeScreenshotRow[];
}

export function ScreenshotUploader({ tradeId, userId, screenshots }: ScreenshotUploaderProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<"idle" | "uploading" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tradeId) return;
    const formData = new FormData(event.currentTarget);
    const files = formData.getAll("screenshots").filter((value): value is File => value instanceof File && value.size > 0);
    if (!files.length) { setError("Choose at least one image."); return; }

    setError(null);
    setState("uploading");
    const supabase = createClient();
    const category = String(formData.get("screenshotCategory"));
    const timeframeValue = String(formData.get("screenshotTimeframe"));
    const caption = String(formData.get("screenshotCaption") ?? "").trim() || null;
    const capturedValue = String(formData.get("screenshotCapturedAt") ?? "").trim();
    const metadata = screenshotMetadataSchema.safeParse({
      tradeId,
      category,
      timeframe: timeframeValue === "UNSET" ? undefined : timeframeValue,
      caption: caption ?? undefined,
      capturedAt: capturedValue ? new Date(capturedValue).toISOString() : undefined,
    });
    if (!metadata.success) { setError(metadata.error.issues[0]?.message ?? "Invalid screenshot metadata."); setState("idle"); return; }

    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = `${userId}/${tradeId}/${crypto.randomUUID()}-${safeName}`;
      const uploadResult = await supabase.storage.from("trade-screenshots").upload(path, file, { contentType: file.type, upsert: false });
      if (uploadResult.error) { setError(uploadResult.error.message); setState("idle"); return; }

      setState("saving");
      const metadataResult = await supabase.from("trade_screenshots").insert({
        user_id: userId,
        trade_id: tradeId,
        category: metadata.data.category,
        timeframe: metadata.data.timeframe ?? null,
        storage_path: path,
        caption: metadata.data.caption ?? null,
        captured_at: metadata.data.capturedAt ?? null,
      });
      if (metadataResult.error) {
        await supabase.storage.from("trade-screenshots").remove([path]);
        setError(metadataResult.error.message);
        setState("idle");
        return;
      }
    }

    setState("done");
    formRef.current?.reset();
    router.refresh();
  }

  return (
    <TradeSection eyebrow="11 · Evidence" title="Trade screenshots" description="Store chart evidence in the private, user-controlled screenshot bucket with category and timeframe metadata.">
      {!tradeId ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Save this trade as a draft first, then upload screenshots from its edit page.</div>
      ) : (
        <>
          <form ref={formRef} onSubmit={upload} className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2 md:col-span-2"><Label htmlFor="screenshots">Image files</Label><Input id="screenshots" name="screenshots" type="file" accept="image/png,image/jpeg,image/webp" multiple required /></div>
            <SelectField name="screenshotCategory" label="Category" items={SCREENSHOT_CATEGORIES.map((value) => ({ label: value.replaceAll("_", " "), value }))} defaultValue="BEFORE_ENTRY" required />
            <SelectField name="screenshotTimeframe" label="Timeframe" items={[{ label: "Not recorded", value: "UNSET" }, ...TIMEFRAMES.map((value) => ({ label: value, value }))]} defaultValue="UNSET" />
            <div className="space-y-2"><Label htmlFor="screenshotCapturedAt">Captured at</Label><Input id="screenshotCapturedAt" name="screenshotCapturedAt" type="datetime-local" /></div>
            <div className="space-y-2 md:col-span-2 xl:col-span-4"><Label htmlFor="screenshotCaption">Caption</Label><Input id="screenshotCaption" name="screenshotCaption" placeholder="What should future-you notice in this chart?" /></div>
            <Button type="submit" disabled={state === "uploading" || state === "saving"} className="self-end"><ImagePlus /> {state === "uploading" ? "Uploading…" : state === "saving" ? "Saving metadata…" : "Upload"}</Button>
          </form>
          {error ? <p role="alert" className="mt-4 rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
          {state === "done" ? <p className="mt-4 text-sm text-profit">Upload complete.</p> : null}
          {screenshots.length ? <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{screenshots.map((screenshot) => <div key={screenshot.id} className="rounded-lg border border-border/70 bg-muted/20 p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">{screenshot.category.replaceAll("_", " ")}</p><p className="mt-2 truncate text-sm font-medium">{screenshot.storage_path.split("/").at(-1)}</p><p className="mt-1 text-xs text-muted-foreground">{screenshot.timeframe ?? "No timeframe"}{screenshot.caption ? ` · ${screenshot.caption}` : ""}</p></div>)}</div> : null}
        </>
      )}
    </TradeSection>
  );
}
