// Whole-brain leaky integrate-and-fire model of the adult fly (FlyWire v783), after
// Shiu et al. 2024, "A Drosophila computational brain model reveals sensorimotor processing"
// (github.com/philshiu/Drosophila_brain_model, MIT). Runs in a Web Worker.
//
//   dv/dt = (v0 - v + g) / t_mbr     dg/dt = -g / tau      (both frozen while refractory)
//   spike: v > v_th -> v = v_reset, g = 0, refractory t_ref
//   each presynaptic spike adds (signed synapse count * w_syn) to g of the target after t_delay
//   stimulated neurons fire as Poisson processes (Shiu: 68.75 mV Poisson kicks, no refractory)
//
// Integration is exact for the linear ODE pair, and it is lazy: between inputs a neuron's state
// has a closed form, so a neuron is only advanced when an input arrives. It is stepped every dt
// only while it *could* reach threshold, i.e. while the upper bound on its future voltage peak
//   (v - v0)+ + PEAK_GAIN * g+   (PEAK_GAIN = max_t of the PSP kernel)
// is at or above (v_th - v0). This keeps the full 138,639-neuron / 15.1M-connection network fast
// in plain JavaScript without changing the model's results.

let N = 0, E = 0;
let rowPtr, targets, weights;            // CSR
let v, g, tLast, refUntil, isActive, activeList, activeCount = 0;
let emPow, egPow, PEAK_GAIN, POW_MAX;
let P;                                   // params
let dt, em, eg, cg, delaySteps, refSteps, wSyn;
let ring = [], ringLen = [];
let step = 0;
let stim = new Map();
const stimIdx = new Map();              // key -> Int32Array (cached indices)                    // key -> { indices: Int32Array, rate }
let superClass, nClasses = 0;
let groupOf;                             // Int16Array neuron -> motor/stim group id (-1)
let groupCounts, groupSizes, groupKeys = [];
let classCounts;
let rasterRow;                           // Int16Array neuron -> raster row (-1)
let rasterFixedRows = 0, RASTER_ROWS = 200, dynRowOwner, rasterEvents = [];
let running = false, speed = 1, totalSpikes = 0, windowSpikes = 0;
let loopTimer = null;
// muscle pools (ragdoll) and per-neuron readouts (articulators)
let muscleOf, muscleCounts, muscleSizes, muscleKeys = [];
let readoutPos, readoutCounts, readoutKey = null;
let lastSpike;                            // step of each neuron's last spike (for STDP traces)
// dopamine-gated plasticity on synapses onto the plastic readout neurons
let plEdge = null, plMap = null, plW, plW0, plElig, plEligT, plInStart, plInIdx, plPre;
let isPlasticPost = null, daPam = 1, daPpl = 1;
const PL = { eta: 0.6, tauElig: 1000, tauPre: 20, wMaxGain: 4, wMaxAbs: 2.5, enabled: true };
let lastDA = 0, dwAccum = 0;
// Spike-frequency adaptation (optional, default on): each spike raises the neuron's threshold by
// ADAPT.dA mV, decaying with ADAPT.tau ms. Not part of Shiu et al.; it keeps broad or recurrent
// input from igniting the model's self-sustained runaway state. a(t) = aSpike * exp(-(t - tSpike)/tau).
const ADAPT = { on: false, dA: 1.0, tau: 150 };   // off by default (pure Shiu model); toggle in Brain settings
let aSpike;
// "Brain worms" (a Grey Leno Show gag: "the worms in my brain only eat the cells I don't need"): an optional,
// engineered lesion that silences neurons which have been quiet for a while and are not sensory, motor or
// readout neurons. An eaten neuron never fires and ignores its inputs; eaten cells survive a brain reset until healed.
const EATEN = 2147483000;                 // refUntil value that marks an eaten neuron
const WORMS = { rate: 0, maxFrac: 0.35 }; // neurons eaten per simulated second; cap as a fraction of N
let eatenList = [], eatenNew = [], wormDebt = 0;
function wormsEat(winMs) {
  if (WORMS.rate <= 0 || eatenList.length >= WORMS.maxFrac * N) return;
  wormDebt += WORMS.rate * winMs / 1000;
  const quiet = step - Math.round(500 / dt);
  for (let tries = 0; wormDebt >= 1 && tries < 4000; tries++) {
    const i = (Math.random() * N) | 0;
    if (refUntil[i] === EATEN || isActive[i] || groupOf[i] >= 0 || muscleOf[i] >= 0 || readoutPos[i] >= 0 || lastSpike[i] > quiet) continue;
    refUntil[i] = EATEN; v[i] = P.v0; g[i] = 0;
    eatenList.push(i); eatenNew.push(i); wormDebt--;
  }
  if (wormDebt > 50) wormDebt = 50;
}
// every spike's neuron index in the current report window (for the neural map), capped
let spikeBuf = new Int32Array(1 << 16), spikeLen = 0;
const SPIKE_CAP = 1 << 19;

const send = (type, data = {}, transfer) => postMessage({ type, ...data }, transfer || []);

async function fetchWithProgress(url, label) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = +res.headers.get('content-length') || 0;
  const reader = res.body.getReader();
  const chunks = []; let got = 0, lastSent = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    if (got - lastSent > 1e6 || got === total) { lastSent = got; send('progress', { label, got, total }); }
  }
  return new Blob(chunks);
}

async function gunzip(blob) {
  const ds = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(ds).arrayBuffer());
}

function decodeConnectome(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (magic !== 'FLYL') throw new Error('bad connectome magic ' + magic);
  let o = 8;
  N = dv.getUint32(o, true); o += 4;
  E = dv.getUint32(o, true); o += 4;
  o += 4; // min_syn
  rowPtr = new Uint32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + (N + 1) * 4)); o += (N + 1) * 4;
  const tLen = dv.getUint32(o, true); o += 4;
  targets = new Int32Array(E);
  let p = o, e = 0;
  for (let r = 0; r < N; r++) {
    let prev = 0;
    const end = rowPtr[r + 1];
    for (; e < end; e++) {
      let x = 0, shift = 0, b;
      do { b = buf[p++]; x |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
      prev += x; targets[e] = prev;
    }
  }
  o += tLen;
  const wLen = dv.getUint32(o, true); o += 4;
  weights = new Int16Array(E);
  p = o;
  for (e = 0; e < E; e++) {
    let x = 0, shift = 0, b;
    do { b = buf[p++]; x |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    weights[e] = (x >>> 1) ^ -(x & 1);
  }
}

function setup(meta) {
  P = meta.params;
  dt = P.dt;                                   // ms
  em = Math.exp(-dt / P.tMbr);
  eg = Math.exp(-dt / P.tau);
  cg = (P.tau / (P.tau - P.tMbr)) * (eg - em); // exact response of v to decaying g
  delaySteps = Math.round(P.tDelay / dt);
  refSteps = Math.round(P.tRef / dt);
  wSyn = P.wSyn;
  // Peak of the normalised PSP kernel c*(e^{-t/tau} - e^{-t/tm})
  const tPk = Math.log(P.tMbr / P.tau) * P.tau * P.tMbr / (P.tMbr - P.tau);
  PEAK_GAIN = (P.tau / (P.tau - P.tMbr)) * (Math.exp(-tPk / P.tau) - Math.exp(-tPk / P.tMbr));
  POW_MAX = Math.round(2000 / dt);             // beyond 2 s a neuron has fully relaxed to rest
  emPow = new Float64Array(POW_MAX + 1); egPow = new Float64Array(POW_MAX + 1);
  for (let k = 0; k <= POW_MAX; k++) { emPow[k] = Math.pow(em, k); egPow[k] = Math.pow(eg, k); }
  v = new Float32Array(N).fill(P.v0);
  g = new Float32Array(N);
  tLast = new Int32Array(N);
  refUntil = new Int32Array(N);
  isActive = new Uint8Array(N);
  activeList = new Int32Array(N);
  ring = Array.from({ length: delaySteps }, () => new Int32Array(1024));
  ringLen = new Int32Array(delaySteps);

  superClass = Uint8Array.from(meta.superClass);
  nClasses = meta.superClasses.length;
  classCounts = new Float64Array(nClasses);

  // groups: motor first, then stimuli (for rate readouts)
  groupOf = new Int16Array(N).fill(-1);
  const groups = [...meta.motor.map((x) => ['m:' + x.key, x.indices]), ...meta.stimuli.map((x) => ['s:' + x.key, x.indices])];
  groupKeys = groups.map((x) => x[0]);
  groupSizes = new Float64Array(groups.length);
  groupCounts = new Float64Array(groups.length);
  // a neuron can belong to a motor group and a fictive stimulus group; motor wins (first)
  groups.forEach(([, idx], gi) => { groupSizes[gi] = idx.length; for (const i of idx) if (groupOf[i] < 0) groupOf[i] = gi; });
  // stimulus-only size correction for shared neurons
  groups.forEach(([, idx], gi) => { groupSizes[gi] = idx.filter((i) => groupOf[i] === gi).length || idx.length; });

  lastSpike = new Int32Array(N).fill(-1e9);
  aSpike = new Float32Array(N);

  // muscle pools
  muscleOf = new Int16Array(N).fill(-1);
  muscleKeys = (meta.muscles || []).map((m) => m.key);
  muscleCounts = new Float64Array(muscleKeys.length);
  muscleSizes = new Float64Array(muscleKeys.length);
  (meta.muscles || []).forEach((m, k) => { muscleSizes[k] = m.indices.length || 1; for (const i of m.indices) muscleOf[i] = k; });

  // per-neuron readout (articulators) + plastic synapses onto them
  readoutPos = new Int16Array(N).fill(-1);
  const ro = (meta.readouts || [])[0];
  if (ro) {
    readoutKey = ro.key;
    ro.indices.forEach((i, k) => { readoutPos[i] = k; });
    readoutCounts = new Float64Array(ro.indices.length);
    if (ro.plastic) setupPlasticity(ro.indices);
  }
  daPam = meta.motor.find((m) => m.key === 'pam')?.indices.length || 1;
  daPpl = meta.motor.find((m) => m.key === 'ppl1')?.indices.length || 1;

  // raster rows: up to 6 neurons per motor group, then per visible stimulus group, then dynamic rows
  rasterRow = new Int16Array(N).fill(-1);
  let row = 0;
  const rowsInfo = [];
  for (const m of meta.motor) for (const i of m.indices.slice(0, 6)) if (rasterRow[i] < 0) { rasterRow[i] = row++; rowsInfo.push('m:' + m.key); }
  for (const s of meta.stimuli) {
    if (s.fictive || s.hidden) continue;
    for (const i of s.indices.slice(0, 6)) if (rasterRow[i] < 0) { rasterRow[i] = row++; rowsInfo.push('s:' + s.key); }
  }
  rasterFixedRows = row;
  dynRowOwner = new Int32Array(RASTER_ROWS - row).fill(-1);
  VTH_GAP = P.vTh - P.v0;
  send('ready', { N, E, rows: RASTER_ROWS, fixedRows: rowsInfo, groupKeys });
}

// ------------------------------------------------------------------ plasticity
// Three-factor rule on every synapse onto the plastic readout neurons (Leno's "vocal tract"):
//   eligibility e: on a postsynaptic spike, e += exp(-(t - t_pre)/tau_pre)  (pre-before-post),
//                  decaying with tau_elig
//   dopamine DA  : tanh((PAM rate - PPL1 rate) / 20 Hz) of the model's own dopaminergic neurons
//   dw = eta * DA * e * w_syn per second; |w| clamped to [0, max(wMaxGain*|w0|, wMaxAbs mV)], sign kept
// Articulations that are followed by dopamine get more drive from the context that produced them.
function setupPlasticity(posts) {
  isPlasticPost = new Uint8Array(N);
  for (const i of posts) isPlasticPost[i] = 1;
  const list = [];
  for (let e = 0; e < E; e++) if (isPlasticPost[targets[e]]) list.push(e);
  plEdge = Int32Array.from(list);
  const n = plEdge.length;
  plMap = new Map();
  plW = new Float32Array(n); plW0 = new Float32Array(n); plElig = new Float32Array(n); plEligT = new Int32Array(n);
  plPre = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    const e = plEdge[k];
    let lo = 0, hi = N - 1;                          // pre neuron: last row with rowPtr <= e
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (rowPtr[mid] <= e) lo = mid; else hi = mid - 1; }
    plPre[k] = lo;
    plMap.set(e, k);
    plW[k] = plW0[k] = weights[e] * wSyn;
  }
  const byPost = new Map();
  for (let k = 0; k < n; k++) { const p = targets[plEdge[k]]; if (!byPost.has(p)) byPost.set(p, []); byPost.get(p).push(k); }
  plInStart = new Map(); const flat = [];
  for (const [p, arr] of byPost) { plInStart.set(p, [flat.length, flat.length + arr.length]); for (const k of arr) flat.push(k); }
  plInIdx = Int32Array.from(flat);
}

function eligDecay(k) {
  const dtSteps = step - plEligT[k];
  if (dtSteps > 0) { plElig[k] *= Math.exp(-(dtSteps * dt) / PL.tauElig); plEligT[k] = step; }
}

function onPlasticPostSpike(post) {
  const r = plInStart.get(post);
  if (!r) return;
  for (let j = r[0]; j < r[1]; j++) {
    const k = plInIdx[j];
    const since = (step - lastSpike[plPre[k]]) * dt;
    if (since > 5 * PL.tauPre) continue;
    eligDecay(k);
    plElig[k] += Math.exp(-since / PL.tauPre);
  }
}

function applyDopamine(winMs, pamRate, pplRate) {
  const da = Math.tanh((pamRate - pplRate) / 20);
  lastDA = da;
  if (!plEdge || !PL.enabled || Math.abs(da) < 0.02) return;
  let dw = 0;
  for (let k = 0; k < plEdge.length; k++) {
    if (plElig[k] < 1e-4) continue;
    eligDecay(k);
    const w0 = plW0[k], sign = w0 >= 0 ? 1 : -1;
    const wMax = Math.max(PL.wMaxGain * Math.abs(w0), PL.wMaxAbs);
    let mag = Math.abs(plW[k]) + PL.eta * da * plElig[k] * wSyn * (winMs / 1000);
    mag = Math.min(wMax, Math.max(0, mag));
    dw += Math.abs(mag * sign - plW[k]);
    plW[k] = mag * sign;
  }
  dwAccum += dw;
}

let dynPtr = 0, dynBudget = 0;
const DYN_EVENTS_PER_REPORT = 1500;

// Bring neuron i's (v, g) from tLast[i] to the current step (exact; frozen while refractory).
function advance(i) {
  const from = refUntil[i] > tLast[i] ? refUntil[i] : tLast[i];
  let k = step - from;
  tLast[i] = step;
  if (k <= 0) return;
  const v0 = P.v0;
  if (k > POW_MAX) { v[i] = v0; g[i] = 0; return; }
  const gi = g[i];
  v[i] = v0 + (v[i] - v0) * emPow[k] + gi * (P.tau / (P.tau - P.tMbr)) * (egPow[k] - emPow[k]);
  g[i] = gi * egPow[k];
}

function canSpike(i) {
  const dv = v[i] - P.v0, gi = g[i];
  return (dv > 0 ? dv : 0) + (gi > 0 ? gi * PEAK_GAIN : 0) >= VTH_GAP;
}

function activate(i) {
  if (!isActive[i]) { isActive[i] = 1; activeList[activeCount++] = i; }
}

function emit(i, slot) {
  let L = ringLen[slot];
  let arr = ring[slot];
  if (L >= arr.length) { const n = new Int32Array(arr.length * 2); n.set(arr); ring[slot] = arr = n; }
  arr[L] = i; ringLen[slot] = L + 1;
  totalSpikes++; windowSpikes++;
  classCounts[superClass[i]]++;
  const gi = groupOf[i];
  if (gi >= 0) groupCounts[gi]++;
  const mu = muscleOf[i];
  if (mu >= 0) muscleCounts[mu]++;
  const rp = readoutPos[i];
  if (rp >= 0) { readoutCounts[rp]++; if (plEdge) onPlasticPostSpike(i); }
  if (ADAPT.on) aSpike[i] = adaptation(i) + ADAPT.dA;
  lastSpike[i] = step;
  if (spikeLen < SPIKE_CAP) {
    if (spikeLen === spikeBuf.length) { const nb = new Int32Array(spikeBuf.length * 2); nb.set(spikeBuf); spikeBuf = nb; }
    spikeBuf[spikeLen++] = i;
  }
  // raster: tagged neurons always; other neurons get a dynamic row (round-robin), capped per report
  let r = rasterRow[i];
  if (r < 0) {
    if (dynBudget <= 0) return;
    dynBudget--;
    const k = dynPtr++ % dynRowOwner.length;
    const prev = dynRowOwner[k];
    if (prev >= 0) rasterRow[prev] = -1;
    dynRowOwner[k] = i; r = rasterFixedRows + k; rasterRow[i] = r;
  } else if (r >= rasterFixedRows) {
    if (dynBudget <= 0) return;
    dynBudget--;
  }
  rasterEvents.push(r, step * dt, superClass[i]);
}

let VTH_GAP = 7;
function adaptation(i) {
  const a = aSpike[i];
  return a === 0 ? 0 : a * Math.exp(-((step - lastSpike[i]) * dt) / ADAPT.tau);
}

function gauss() {
  return Math.sqrt(-2 * Math.log(Math.random() || 1e-12)) * Math.cos(2 * Math.PI * Math.random());
}

function simStep() {
  const slot = step % delaySteps;
  // 1) deliver spikes emitted delaySteps ago (lazy targets are advanced first)
  const L = ringLen[slot], arr = ring[slot];
  for (let k = 0; k < L; k++) {
    const pre = arr[k];
    const end = rowPtr[pre + 1];
    for (let e = rowPtr[pre]; e < end; e++) {
      const post = targets[e];
      if (refUntil[post] === EATEN) continue;
      const w = (isPlasticPost !== null && isPlasticPost[post]) ? plW[plMap.get(e)] : weights[e] * wSyn;
      if (!isActive[post]) {
        advance(post);
        g[post] += w;
        if (canSpike(post)) { isActive[post] = 1; activeList[activeCount++] = post; }
      } else {
        g[post] += w;
      }
    }
  }
  ringLen[slot] = 0;

  // 2) Poisson drive (stimulated neurons fire; the 68.75 mV kick always crosses threshold)
  for (const s of stim.values()) {
    const p = s.rate * dt * 1e-3;
    if (p <= 0) continue;
    // number of spikes this step ~ Poisson(n p); pick that many neurons at random
    const n = s.indices.length, lam = n * p;
    let k = 0;
    if (lam > 30) k = Math.max(0, Math.round(lam + Math.sqrt(lam) * gauss()));
    else { const L = Math.exp(-lam); let q = Math.random(); while (q > L) { k++; q *= Math.random(); } }
    for (let c = 0; c < k; c++) {
      const i = s.indices[(Math.random() * n) | 0];
      if (refUntil[i] === EATEN) continue;
      if (!isActive[i]) advance(i);
      v[i] = P.vReset; g[i] = 0; emit(i, slot);
    }
  }

  // 3) step the neurons that could reach threshold; the rest go back to lazy updates
  const v0 = P.v0, vth = P.vTh, vr = P.vReset, next = step + 1;
  for (let k = 0; k < activeCount; k++) {
    const i = activeList[k];
    if (refUntil[i] > step) { tLast[i] = next; continue; }   // frozen while refractory
    const gi = g[i];
    const vi = v0 + (v[i] - v0) * em + gi * cg;
    g[i] = gi * eg;
    tLast[i] = next;
    if (vi > vth && (!ADAPT.on || vi > vth + adaptation(i))) {
      v[i] = vr; g[i] = 0; refUntil[i] = step + refSteps;
      emit(i, slot);
    } else {
      v[i] = vi;
      const dvp = vi - v0, gp = gi * eg;
      if ((dvp > 0 ? dvp : 0) + (gp > 0 ? gp * PEAK_GAIN : 0) < VTH_GAP) {
        isActive[i] = 0;
        activeList[k] = activeList[--activeCount]; k--;
      }
    }
  }
  step++;
}

// ------------------------------------------------------------------ run loop
let lastReport = 0, lastWall = 0, wallAcc = 0, stepsAcc = 0;
const REPORT_MS = 50;

function loop() {
  if (!running) return;
  const now = performance.now();
  const wallDt = Math.min(100, now - lastWall);
  lastWall = now;
  // steps owed for real-time * speed, but never spend more than ~12 ms per tick
  const want = (wallDt * speed) / dt;
  const budgetEnd = now + 12;
  let done = 0;
  while (done < want && performance.now() < budgetEnd) {
    for (let k = 0; k < 10 && done < want; k++, done++) simStep();
  }
  wallAcc += wallDt; stepsAcc += done;
  if (now - lastReport >= REPORT_MS) report(now);
  loopTimer = setTimeout(loop, 0);
}

function report(now) {
  const winMs = stepsAcc * dt || 1e-9;             // simulated ms in window
  const rates = {};
  for (let k = 0; k < groupKeys.length; k++) {
    rates[groupKeys[k]] = (groupCounts[k] / groupSizes[k]) / (winMs / 1000);
    groupCounts[k] = 0;
  }
  const classes = Array.from(classCounts); classCounts.fill(0);
  applyDopamine(winMs, rates['m:pam'] || 0, rates['m:ppl1'] || 0);
  wormsEat(winMs);
  const eaten = Int32Array.from(eatenNew); eatenNew.length = 0;
  const muscles = {};
  for (let k = 0; k < muscleKeys.length; k++) { muscles[muscleKeys[k]] = (muscleCounts[k] / muscleSizes[k]) / (winMs / 1000); muscleCounts[k] = 0; }
  const readout = readoutCounts ? Float32Array.from(readoutCounts) : null;
  const spikes = spikeBuf.slice(0, spikeLen); spikeLen = 0;
  if (readoutCounts) readoutCounts.fill(0);
  const ev = Float32Array.from(rasterEvents); rasterEvents.length = 0;
  send('tick', {
    t: step * dt / 1000, realtime: winMs / (wallAcc || 1), spikesPerSec: windowSpikes / (winMs / 1000),
    active: activeCount, rates, classes, raster: ev, winMs, muscles, readout, spikes,
    dopamine: lastDA, plasticity: dwAccum, plasticEdges: plEdge ? plEdge.length : 0,
    eaten, eatenTotal: eatenList.length,
  }, [ev.buffer, spikes.buffer, eaten.buffer]);
  dwAccum = 0;
  windowSpikes = 0; wallAcc = 0; stepsAcc = 0; lastReport = now; dynBudget = DYN_EVENTS_PER_REPORT;
}

function reset() {
  v.fill(P.v0); g.fill(0); tLast.fill(0); refUntil.fill(0); isActive.fill(0); activeCount = 0;
  ringLen.fill(0); step = 0; totalSpikes = 0; lastSpike.fill(-1e9); aSpike.fill(0);
  if (plEdge) { plElig.fill(0); plEligT.fill(0); }   // learned weights survive a reset
  for (const i of eatenList) refUntil[i] = EATEN;     // so do the brain worms' meals (until healed)
}

onmessage = async ({ data }) => {
  try {
    switch (data.type) {
      case 'init': {
        const [meta, bin] = await Promise.all([
          fetch(data.base + 'data/neurons.json').then((r) => r.json()),
          fetchWithProgress(data.base + 'data/connectome.bin.gz', 'connectome'),
        ]);
        send('status', { text: 'decompressing…' });
        const raw = await gunzip(bin);
        send('status', { text: 'decoding 15M connections…' });
        decodeConnectome(raw);
        setup(meta);
        break;
      }
      case 'stim': {
        // indices may be omitted for a rate-only update of a known group (live hearing input)
        const cur = stim.get(data.key);
        if (data.indices) stimIdx.set(data.key, Int32Array.from(data.indices));
        const idx = stimIdx.get(data.key);
        if (data.rate > 0 && idx) {
          if (cur) cur.rate = data.rate; else stim.set(data.key, { indices: idx, rate: data.rate });
        } else stim.delete(data.key);
        break;
      }
      case 'adaptation':
        Object.assign(ADAPT, data.params || {});
        if (!ADAPT.on) aSpike.fill(0);
        break;
      case 'plasticity':
        Object.assign(PL, data.params || {});
        if (data.resetWeights && plEdge) { plW.set(plW0); plElig.fill(0); }
        break;
      case 'run':
        running = true; lastWall = lastReport = performance.now(); clearTimeout(loopTimer); loop();
        break;
      case 'pause': running = false; clearTimeout(loopTimer); break;
      case 'speed': speed = data.value; break;
      case 'reset': reset(); break;
      case 'worms':
        if (data.rate !== undefined) WORMS.rate = data.rate;
        if (data.heal) {
          for (const i of eatenList) { refUntil[i] = 0; tLast[i] = step; v[i] = P.v0; g[i] = 0; }
          eatenList = []; eatenNew = []; wormDebt = 0;
          send('healed');
        }
        break;
    }
  } catch (err) {
    send('error', { message: err.message || String(err) });
  }
};
