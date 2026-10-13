/**
 * Showing and hiding a sheet with its motion. A sheet is hidden by the
 * `hidden` attribute, which cannot be animated, so closing plays the
 * `closing` animation (index.html) first and hides it after; opening
 * again in the meantime cancels the close. `open` is the caller's own
 * flag and changes at once, so a sheet on its way out is already closed.
 */
const CLOSE_MS = 220

const pending = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()

export function showSheet(sheet: HTMLElement): void {
  const timer = pending.get(sheet)
  if (timer !== undefined) clearTimeout(timer)
  pending.delete(sheet)
  sheet.classList.remove('closing')
  sheet.hidden = false
}

export function hideSheet(sheet: HTMLElement): void {
  if (sheet.hidden || pending.has(sheet)) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    sheet.hidden = true
    return
  }
  sheet.classList.add('closing')
  pending.set(
    sheet,
    setTimeout(() => {
      pending.delete(sheet)
      sheet.classList.remove('closing')
      sheet.hidden = true
    }, CLOSE_MS),
  )
}
