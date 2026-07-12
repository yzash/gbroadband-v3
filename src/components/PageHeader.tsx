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
    <div className="flex items-end justify-between gap-4 border-b border-line px-5 py-3">
      <div>
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        {stage && <div className="text-2xs uppercase tracking-wider text-ink-3">{stage}</div>}
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
        <div className="max-w-md text-center text-ink-3">
          <div className="mb-2 text-4xl opacity-40">◍</div>
          <p className="text-sm">{note}</p>
        </div>
      </div>
    </div>
  );
}
