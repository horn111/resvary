export function normalizeReleaseNotes(value) {
  return value.replace(/\r\n?/g, '\n').trim();
}
