import { ShieldCheck, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/lib/i18n";

const KEY = "aura-privacy-seen";

/** First-visit notice: everything runs locally. Reopenable via the header button. */
export function usePrivacyDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setOpen(true);
    } catch {
      /* ignore */
    }
  }, []);
  const close = (v: boolean) => {
    setOpen(v);
    if (!v) {
      try {
        localStorage.setItem(KEY, "1");
      } catch {
        /* ignore */
      }
    }
  };
  return { open, setOpen: close };
}

export function PrivacyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useLang();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="v2-theme max-w-md rounded-2xl">
        <div className="flex size-10 items-center justify-center rounded-full bg-[var(--v2-valid)]/10">
          <ShieldCheck className="size-5 text-[var(--v2-valid)]" />
        </div>
        <DialogTitle className="text-lg tracking-tight">
          {t("Everything stays on your computer.", "Alles bleibt lokal auf deinem Rechner.")}
        </DialogTitle>
        <DialogDescription className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <span className="block">
            {t(
              "Simple, free and without an account. No upload, no cloud: your ADM masters are read, rendered and auditioned entirely inside this browser tab.",
              "Einfach, kostenlos und ohne Konto. Kein Upload, keine Cloud: Deine ADM-Master werden vollständig in diesem Browser-Tab gelesen, gerendert und vorgehört.",
            )}
          </span>
        </DialogDescription>
        <div className="flex gap-3 rounded-xl border border-border p-3 text-xs leading-relaxed">
          <WifiOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            {t(
              "Want to be sure? Once the page has loaded, switch on airplane mode or disconnect Wi-Fi — AURA keeps working.",
              "Du willst sichergehen? Sobald die Seite geladen ist, aktiviere den Flugmodus oder trenne das WLAN — AURA funktioniert weiter.",
            )}
          </span>
        </div>
        <button
          onClick={() => onOpenChange(false)}
          className="w-full rounded-full bg-foreground px-4 py-2.5 text-sm font-semibold text-background hover:opacity-90"
        >
          {t("Got it", "Verstanden")}
        </button>
      </DialogContent>
    </Dialog>
  );
}
