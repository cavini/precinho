import { describe, expect, it } from 'vitest'
import { PostalCode } from './PostalCode'

describe('PostalCode', () => {
  it('keeps the eight digits of a CEP', () => {
    expect(PostalCode.tryParse('01310100')?.digits).toBe('01310100')
  })

  it('accepts the masked form people actually type', () => {
    expect(PostalCode.tryParse('01310-100')?.digits).toBe('01310100')
    expect(PostalCode.tryParse(' 01310 100 ')?.digits).toBe('01310100')
  })

  it('rejects the wrong number of digits', () => {
    expect(PostalCode.tryParse('0131010')).toBeNull()
    expect(PostalCode.tryParse('013101009')).toBeNull()
    expect(PostalCode.tryParse('')).toBeNull()
  })

  it('rejects a repeated-digit CEP, which passes the mask but never resolves', () => {
    expect(PostalCode.tryParse('00000000')).toBeNull()
    expect(PostalCode.tryParse('11111111')).toBeNull()
  })

  it('renders itself masked', () => {
    expect(PostalCode.tryParse('01310100')!.formatted).toBe('01310-100')
  })

  it('compares by digits, however it was typed', () => {
    const masked = PostalCode.tryParse('01310-100')!
    const bare = PostalCode.tryParse('01310100')!
    expect(masked.equals(bare)).toBe(true)
    expect(masked.equals(PostalCode.tryParse('22071900')!)).toBe(false)
  })

  describe('mask — used while the field is still being typed', () => {
    it('adds the hyphen once there are more than five digits', () => {
      expect(PostalCode.mask('013')).toBe('013')
      expect(PostalCode.mask('01310')).toBe('01310')
      expect(PostalCode.mask('013101')).toBe('01310-1')
      expect(PostalCode.mask('01310100')).toBe('01310-100')
    })

    it('drops anything past eight digits instead of growing forever', () => {
      expect(PostalCode.mask('013101009999')).toBe('01310-100')
    })

    it('ignores letters and punctuation as they are typed', () => {
      expect(PostalCode.mask('cep 01310-100')).toBe('01310-100')
    })
  })
})
