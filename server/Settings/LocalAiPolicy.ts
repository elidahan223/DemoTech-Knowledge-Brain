export function localOllamaUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error('Ollama must use loopback HTTP without embedded credentials');
  return url;
}
export function assertLocalModelName(name: string) {
  if (!name.trim() || /cloud|https?:\/\//i.test(name))
    throw new Error('Only locally installed models are allowed');
  return name;
}
