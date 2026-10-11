export function PageHeader({
  title,
  stage,
  children,
}: {
  title: string;
  stage?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line bg-surface/40 px-6 py-4">
      <div>
        {stage && <div className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-globe-sky">{stage}</div>}
        <h1 className="font-display text-xl font-bold tracking-tight text-ink">{title}</h1>
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function Stub({ title, stage, note }: { title: string; stage: string; note: string }) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={title} stage={stage} />
      <div className="grid flex-1 place-items-center p-8">
        <p className="max-w-md text-center text-sm text-ink-3">{note}</p>
      </div>
    </div>
  );
}
