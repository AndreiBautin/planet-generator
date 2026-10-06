/**
 * Keep a picture of the view: the share sheet where it can carry a file
 * (most phones), a download everywhere else. Returns what to say, or
 * nothing when the sheet said it.
 */
export async function savePicture(blob: Blob, name: string): Promise<string | undefined> {
  const file = new File([blob], `${name}.png`, { type: 'image/png' })
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name })
      return undefined
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return undefined
    }
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 10_000)
  return 'Picture saved'
}

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
