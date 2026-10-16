import { describe, expect, it } from 'vitest'
import { compress, decompress } from './tinyuz'

const repeat = (count: number, color: number[]): number[] => Array.from({ length: count }, () => color).flat()

/** Inputs of the lian-li-linux reference fixtures (tests/tinyuz_reference.rs). */
const RAW: Record<string, number[]> = {
  '01_static_16led': repeat(16, [255, 128, 0]),
  '02_static_40led': repeat(40, [0, 255, 0]),
  '03_breathing_40led': Array.from({ length: 40 }, (_, i) =>
    i % 2 === 0 ? [255, 0, 0] : [0, 0, 255]
  ).flat(),
  '04_palette_16': [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [255, 0, 255],
    [0, 255, 255],
    [128, 0, 0],
    [0, 128, 0],
    [0, 0, 128],
    [128, 128, 0],
    [128, 0, 128],
    [0, 128, 128],
    [64, 64, 64],
    [192, 192, 192],
    [255, 255, 255],
    [0, 0, 0]
  ].flat(),
  '05_slv3_group': Array.from({ length: 6 }, (_, fan) =>
    repeat(40, [(fan * 40) & 255, 128, 255 - fan * 40])
  ).flat(),
  '06_slinf_group': Array.from({ length: 5 }, (_, fan) => repeat(44, [(fan * 50) & 255, 200, 55])).flat(),
  '07_gradient_80': Array.from({ length: 80 }, (_, i) => [i, (i * 2) & 255, 255 - i]).flat(),
  '08_black': new Array<number>(240).fill(0),
  '09_white': new Array<number>(240).fill(255),
  '10_tl_flex': Array.from({ length: 4 }, (_, fan) =>
    Array.from({ length: 26 }, (_, led) => [(fan * 60 + led) & 255, 100, (fan * 30 + led) & 255]).flat()
  ).flat()
}

/** Reference encoder outputs (tests/fixtures/*.yuz). */
const FIXTURES: Record<string, string> = {
  '01_static_16led': '03000000e7ff80001b030600',
  '02_static_40led': '03000000f700ff006e180300',
  '03_breathing_40led': '060000006bff00ffaf83060100',
  '04_palette_16': '2200000023ff008304016a08ff80610e04500108800d400151c022621600',
  '05_slv3_group': '03000000f70080ff6eee032880d7ddde5080afbbbd788087777ba0805feff6c88037de2d0300',
  '06_slinf_group': '03000000a700c837aa490332d59b64aa3796556fc8aa5e0600',
  '07_gradient_80':
    '0100000032001f0000ff0102fe0204fd0306fc0408fb050afa060cf9070ef80810f70912f60a14f50b16f40c18f30d1af20e1cf10f1ef01020ef1122ee1224ed1326ec1428eb152aea162ce9172ee81830e71932e61a34e51b36e41c38e31d3ae21e3ce11f3ee02040df2142de2244dd2346dc2448db254ada264cd9274ed82850d72952d62a54d52b56d42c58d32d5ad22e5cd12f5ed03060cf3162ce3264cd3366cc3468cb356aca366cc9376ec83870c73972c63a74c53b76c43c78c33d7ac23e7cc13f7ec04080bf4182be4284bd4386bc4488bb458aba468cb9478eb84890b74992b64a94b54b96b44c98b34d9ab24e9cb14f9eb00600',
  '08_black': '01000000bd007f1900',
  '09_white': '01000000bdff7f1900',
  '10_tl_flex':
    '010000007a001b0064000164010264020364030464040564050664060764070864080964090a640a0b640b0c640c0d640d0e640e0f640f1064101164111264121364131464141564151664161764171864181964193c641e3d641f3e64203f642140642241642342642443642544642645642746642847642948642a49642b4a642c4b642d4c642e4d642f4e64304f643150643251643352643453643554643655643778643c79643d7a643e7b643f7c64407d64417e64427f644380644481644582644683644784644885644986644a87644b88644c89644d8a644e8b644f8c64508d64518e64528f6453906454916455b4645ab5645bb6645cb7645db8645eb9645fba6460bb6461bc6462bd6463be6464bf6465c06466c16467c26468c36469c4646ac5646bc6646cc7646dc8646ec9646fca6470cb6471cc6472cd64730600'
}

const bytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g)!.map((pair) => parseInt(pair, 16)))

describe('tinyuz decoder', () => {
  it.each(Object.keys(FIXTURES))('decodes the reference stream %s', (name) => {
    const raw = Uint8Array.from(RAW[name]!)
    expect([...decompress(bytes(FIXTURES[name]!), raw.length)]).toEqual([...raw])
  })
})

describe('tinyuz encoder', () => {
  it.each(Object.keys(RAW))('round-trips %s', (name) => {
    const raw = Uint8Array.from(RAW[name]!)
    const stream = compress(raw)
    expect([...decompress(stream, raw.length)]).toEqual([...raw])
  })

  it('compresses solid frames as well as the reference encoder', () => {
    expect(compress(Uint8Array.from(RAW['08_black']!)).length).toBeLessThanOrEqual(
      bytes(FIXTURES['08_black']!).length
    )
    expect(compress(Uint8Array.from(repeat(174, [255, 255, 255]))).length).toBeLessThan(16)
  })

  it('round-trips long animations and pseudo-random data within the dictionary', () => {
    let seed = 42
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed & 0xff
    }
    const noise = Uint8Array.from({ length: 6000 }, random)
    expect([...decompress(compress(noise), noise.length)]).toEqual([...noise])

    const frames = Uint8Array.from(
      Array.from({ length: 40 }, (_, frame) =>
        Array.from({ length: 174 }, (_, led) => [
          (frame * 7 + led) & 255,
          (frame * 3) & 255,
          (led * 5) & 255
        ]).flat()
      ).flat()
    )
    const stream = compress(frames)
    expect([...decompress(stream, frames.length)]).toEqual([...frames])
    // The header announces the largest distance used, which must fit the 4 KB dictionary.
    expect(new DataView(stream.buffer).getUint32(0, true)).toBeLessThanOrEqual(4096)
  })
})
