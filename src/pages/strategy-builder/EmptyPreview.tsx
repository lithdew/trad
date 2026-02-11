export function EmptyPreview() {
  return (
    <div className="h-full flex flex-col items-center justify-center px-10 text-center">
      <div className="size-16 rounded-2xl bg-primary/8 border border-primary/10 flex items-center justify-center mb-6">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="text-primary">
          <path d="M14 3v22M3 14h22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <rect x="6" y="6" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">No strategy yet</h3>
      <p className="text-muted-foreground text-sm max-w-xs leading-relaxed">
        Describe your strategy in the chat and watch the dashboard appear in real-time.
      </p>
    </div>
  );
}
