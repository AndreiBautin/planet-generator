/**
 * Share a planet's link: the system share sheet where there is one (every
 * phone), the clipboard where there is not (most desktops). The link is the
 * whole planet, so sharing it is sharing the world.
 *
 * Returns what the person should be told, or nothing when the share sheet
 * said it for itself.
 */
export async function shareLink(title: string, url: string): Promise<string | undefined> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text: `${title} — a generated planet`, url })
      return undefined
    } catch (error) {
      // Dismissing the sheet is a choice, not a failure: say nothing.
      if (error instanceof DOMException && error.name === 'AbortError') return undefined
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    return 'Link copied'
  } catch {
    // No sheet and no clipboard (an insecure origin, a refused permission):
    // the address bar already holds the link, so point there.
    return 'Copy the link from the address bar'
  }
}
