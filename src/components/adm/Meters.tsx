interface Props {
  peaks: Float32Array | null;
  channels: number;
}

const dbfs = (v: number) => (v <= 0 ? -120 : 20 * Math.log10(v));

/** Per-ACN-channel peak level meters. */
export function Meters({ peaks, channels }: Props) {
  const items = Array.from({ length: channels }, (_, i) => peaks?.[i] ?? 0);
  return (
    <div className="grid grid-cols-8 gap-1 sm:grid-cols-12 lg:grid-cols-16">
      {items.map((v, i) => {
        const db = dbfs(v);
        const pct = Math.max(0, Math.min(1, (db + 60) / 60));
        const over = db > -0.2;
        return (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="relative h-20 w-full overflow-hidden rounded-sm bg-secondary">
              <div
                className={`absolute bottom-0 left-0 w-full transition-[height] duration-75 ${
                  over ? "bg-destructive" : "bg-primary"
                }`}
                style={{ height: `${pct * 100}%` }}
              />
            </div>
            <span className="font-mono text-[9px] text-muted-foreground">{i}</span>
          </div>
        );
      })}
    </div>
  );
}
