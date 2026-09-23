// Descending-neuron firing rates (Hz) -> Leno motor command.
// Gains are "rate at which the behaviour saturates"; tweak in the console via window.flyleno.motorGains.
export const motorGains = {
  forward: 40,    // P9 / P9-oDN1
  backward: 40,   // MDN
  turn: 40,       // DNa01/02 left - right (ipsilateral turning)
  startle: 15,    // giant fiber
  groom: 40,      // aDN1
  feed: 40,       // MN9
};

const sat = (x) => Math.max(0, Math.min(1, x));
const tauMs = 250;
const ema = {};

const emaFast = {};
const fast = (k) => emaFast[k] ?? 0;

export function decodeMotor(rates, winMs) {
  const a = 1 - Math.exp(-winMs / tauMs);
  const af = 1 - Math.exp(-winMs / 80);
  for (const k in rates) emaFast[k] = (emaFast[k] ?? 0) + (rates[k] - (emaFast[k] ?? 0)) * af;
  for (const k in rates) ema[k] = (ema[k] ?? 0) + (rates[k] - (ema[k] ?? 0)) * a;
  const r = (k) => ema['m:' + k] ?? 0;
  return {
    command: {
      forward: sat(r('forward') / motorGains.forward),
      backward: sat(r('backward') / motorGains.backward),
      turn: Math.max(-1, Math.min(1, (r('turnL') - r('turnR')) / motorGains.turn)),
      // startle: fast (80 ms) average, so a real GF volley counts but a stray spike does not
      startle: sat(fast('m:startle') / motorGains.startle),
      groom: sat(r('groom') / motorGains.groom),
      feed: sat(r('feed') / motorGains.feed),
    },
    smoothed: ema,
  };
}
