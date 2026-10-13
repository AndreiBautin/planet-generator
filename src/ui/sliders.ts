/**
 * The sliders' lit track (index.html, `--fill`): how far along each one
 * stands, kept up as a hand moves it and refreshed when code sets values,
 * which fires no event.
 */
export const fillOf = (value: number, min: number, max: number): number =>
  max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0

const fill = (input: HTMLInputElement): void => {
  const share = fillOf(Number(input.value), Number(input.min || 0), Number(input.max || 100))
  input.style.setProperty('--fill', `${share.toFixed(1)}%`)
}

export function refreshSliders(): void {
  for (const input of document.querySelectorAll<HTMLInputElement>('input[type="range"]'))
    fill(input)
}

export function attachSliders(): void {
  document.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === 'range')
      fill(event.target)
  })
  refreshSliders()
}
