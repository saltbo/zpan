import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AmbientCanvas } from './ambient-canvas'

describe('AmbientCanvas', () => {
  it('renders as a hidden decorative layer that never takes pointer events', () => {
    const { container } = render(<AmbientCanvas />)
    const layer = container.firstElementChild as HTMLElement
    expect(layer.getAttribute('aria-hidden')).toBe('true')
    expect(layer.className).toContain('pointer-events-none')
    expect(layer.querySelector('button, a, input')).toBeNull()
  })

  it('paints grid and spotlight for the page variant', () => {
    const { container } = render(<AmbientCanvas variant="page" />)
    const layers = container.querySelectorAll('[style]')
    expect(layers.length).toBe(2)
    const styles = [...layers].map((el) => el.getAttribute('style'))
    expect(styles.some((s) => s.includes('conic-gradient'))).toBe(true)
    expect(styles.some((s) => s.includes('repeating-linear-gradient'))).toBe(true)
  })

  it('paints the grid only for the band variant', () => {
    const { container } = render(<AmbientCanvas variant="band" />)
    const layers = container.querySelectorAll('[style]')
    expect(layers.length).toBe(1)
    expect(layers[0].getAttribute('style')).toContain('repeating-linear-gradient')
  })

  it('derives its colors from the brandable ring, not a fixed hue', () => {
    const { container } = render(<AmbientCanvas />)
    const styles = [...container.querySelectorAll('[style]')].map((el) => el.getAttribute('style') ?? '')
    expect(styles.some((s) => s.includes('color-mix(in oklab, var(--zpan-theme-ring)'))).toBe(true)
    expect(styles.some((s) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(s))).toBe(false)
  })
})
