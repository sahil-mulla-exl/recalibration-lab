type DiagnosticsSectionHeadingProps = {
  title: string;
  subtitle?: string;
};

export function DiagnosticsSectionHeading({ title, subtitle }: DiagnosticsSectionHeadingProps) {
  return (
    <div className="pt-2 pb-1 border-b border-border/60">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      {subtitle ? <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p> : null}
    </div>
  );
}
