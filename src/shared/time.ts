let nowProvider = (): Date => new Date();

export function nowIso(): string {
  return nowProvider().toISOString();
}

export function setNowProvider(provider: () => Date): () => void {
  const previous = nowProvider;
  nowProvider = provider;
  return () => {
    nowProvider = previous;
  };
}
