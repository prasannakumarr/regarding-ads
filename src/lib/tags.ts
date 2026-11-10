export const tagKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
export function tagLabel(value: string) {
  const key = tagKey(value);
  return key.charAt(0).toUpperCase() + key.slice(1);
}
