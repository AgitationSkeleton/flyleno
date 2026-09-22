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

export function decodeMotor(rates, winMs) {
  const a = 1 - Math.exp(-winMs / tauMs);
  for (const k in rates) ema[k] = (ema[k] ?? 0) + (rates[k] - (ema[k] ?? 0)) * a;
  const r = (k) => ema['m:' + k] ?? 0;
  return {
    command: {
      forward: sat(r('forward') / motorGains.forward),
      backward: sat(r('backward') / motorGains.backward),
      turn: Math.max(-1, Math.min(1, (r('turnL') - r('turnR')) / motorGains.turn)),
      // startle uses the raw window rate so a single GF volley is not smoothed away
      startle: sat((rates['m:startle'] ?? 0) / motorGains.startle),
      groom: sat(r('groom') / motorGains.groom),
      feed: sat(r('feed') / motorGains.feed),
    },
    smoothed: ema,
  };
}
