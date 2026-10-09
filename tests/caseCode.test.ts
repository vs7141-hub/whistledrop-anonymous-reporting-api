import { CASE_CODE_REGEX, generateCaseCode, hashCaseCode, normalizeCaseCode } from '../src/utils/caseCode';

describe('case code generation (unit)', () => {
  it('has the documented format: WD- plus six groups of 4 Crockford-Base32 characters', () => {
    for (let i = 0; i < 200; i++) expect(generateCaseCode()).toMatch(CASE_CODE_REGEX);
  });

  it('never repeats (5000 codes, all distinct) - sanity check of the randomness source', () => {
    const codes = new Set(Array.from({ length: 5000 }, generateCaseCode));
    expect(codes.size).toBe(5000);
  });

  it('is not sequential or time-based: consecutive codes share no common prefix pattern', () => {
    const a = generateCaseCode().slice(3, 12);
    const b = generateCaseCode().slice(3, 12);
    expect(a).not.toBe(b);
  });

  it('uses every symbol of the alphabet (roughly uniform output, no stuck bits)', () => {
    const seen = new Set(Array.from({ length: 2000 }, generateCaseCode).join('').replace(/WD|-/g, ''));
    expect(seen.size).toBe(32);
  });

  it('hashes deterministically (needed for lookup) and the hash reveals nothing readable', () => {
    const code = generateCaseCode();
    expect(hashCaseCode(code)).toBe(hashCaseCode(code));
    expect(hashCaseCode(code)).not.toBe(hashCaseCode(generateCaseCode()));
    expect(hashCaseCode(code)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCaseCode(code)).not.toContain(code.replace(/-/g, ''));
  });

  it('normalizes case/whitespace and rejects malformed codes', () => {
    expect(normalizeCaseCode('  wd-abcd  ')).toBe('WD-ABCD');
    expect(CASE_CODE_REGEX.test('WD-7K2M-9QXD-4TNB-0H8J-WE3C-5RVA')).toBe(true);
    expect(CASE_CODE_REGEX.test('WD-7K2M-9QXD-4TNB-0H8J-WE3C')).toBe(false); // too short
    expect(CASE_CODE_REGEX.test('WD-7K2M-9QXD-4TNB-0H8J-WE3C-5RVU')).toBe(false); // U not in alphabet
    expect(CASE_CODE_REGEX.test('1234')).toBe(false);
  });
});
