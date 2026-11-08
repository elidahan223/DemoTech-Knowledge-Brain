export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const r = await fetch('/api' + url, options);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'שגיאת שרת');
  return data;
}
