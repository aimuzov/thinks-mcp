import { describe, expect, it } from 'vitest'
import { measureTypography, shareOf } from './antipatterns.js'

const share = (label: string, texts: string[]) =>
  shareOf(measureTypography(texts), label)

describe('measureTypography', () => {
  it('counts a mark once per text, whatever the number of hits', () => {
    expect(share('кавычки-ёлочки «»', ['«раз» и «два»', 'без них'])).toBe(50)
  })

  it('takes the double hyphen only where it stands for a dash', () => {
    const texts = [
      'pidof вместо wget --no-check-certificate',
      'docker compose --profile amneziawg up -d',
      '---------- чтение ----------',
      'ключ--значение',
      'Кеш живёт до перезапуска -- дольше не нужно.',
    ]
    expect(share('двойной дефис --', texts)).toBe(20)
  })

  it('leaves every probe at zero for a corpus without them', () => {
    const measured = measureTypography(['Обычный текст без знаков.'])
    expect(measured.every(a => a.share === 0)).toBe(true)
  })

  it('returns undefined for a probe that was never measured', () => {
    expect(shareOf([], 'длинное тире —')).toBeUndefined()
    expect(shareOf(undefined, 'длинное тире —')).toBeUndefined()
  })
})
