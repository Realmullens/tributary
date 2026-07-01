export function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "-").slice(0, 60) || "track";
}

/** Base filename shared by track downloads and the FCP/Premiere XML, so the
 *  XML's file references match what the host actually downloaded. */
export function trackDownloadBase(participantName: string, type: string, trackId: string): string {
  return `${safeName(participantName)}-${type}-${trackId.slice(0, 6)}`;
}
