export const types: Record<string, { label: string; color: string; symbol: string }> = {
  community: { label: 'קבוצות ידע', color: '#b49cfa', symbol: '⬢' },
  document: { label: 'מסמכים', color: '#8e9cfa', symbol: '▤' },
  person: { label: 'אנשים', color: '#f8ba77', symbol: '●' },
  department: { label: 'מחלקות', color: '#63cfbe', symbol: '◆' },
  process: { label: 'תהליכים', color: '#ec94c1', symbol: '↻' },
  system: { label: 'מערכות', color: '#77bdf8', symbol: '▣' },
};
export const statusLabels: Record<string, string> = {
  ready: 'מאונדקס',
  queued: 'בתור',
  processing: 'מחלץ טקסט',
  embedding: 'יוצר Embeddings',
  error: 'שגיאה',
  cancelled: 'בוטל',
};
