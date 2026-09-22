"""
Brute-force reference simulation of the Shiu et al. 2024 LIF model (every neuron stepped every dt,
same exact integration) used to validate the browser engine (js/brain-worker.js).

    python tools/reference_sim.py --stim stink --on 1.0 --off 1.0

Prints spikes per 100 ms window and motor-group rates.
"""
import argparse
import json
import os

import numpy as np
import pandas as pd
import scipy.sparse as sp

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument("--shiu", default=r"D:\Claude_FruitFly\sources\philshiu__Drosophila_brain_model")
ap.add_argument("--stim", default="snack")
ap.add_argument("--on", type=float, default=1.0, help="seconds of stimulation")
ap.add_argument("--off", type=float, default=0.5, help="seconds after stimulation")
ap.add_argument("--seed", type=int, default=0)
args = ap.parse_args()

meta = json.load(open(os.path.join(HERE, "..", "data", "neurons.json")))
P = meta["params"]
N = meta["N"]
con = pd.read_parquet(os.path.join(args.shiu, "Connectivity_783.parquet"),
                      columns=["Presynaptic_Index", "Postsynaptic_Index", "Excitatory x Connectivity"])
# CSR by presynaptic row: a spike from i adds row i to g
W = sp.csr_matrix((con["Excitatory x Connectivity"].values * P["wSyn"],
                   (con["Presynaptic_Index"].values, con["Postsynaptic_Index"].values)), shape=(N, N))

dt = P["dt"]
em, eg = np.exp(-dt / P["tMbr"]), np.exp(-dt / P["tau"])
cg = P["tau"] / (P["tau"] - P["tMbr"]) * (eg - em)
D = round(P["tDelay"] / dt)
R = round(P["tRef"] / dt)
stim = next(s for s in meta["stimuli"] if s["key"] == args.stim)
sidx = np.array(stim["indices"])
p = stim["rate"] * dt * 1e-3
rng = np.random.default_rng(args.seed)

v = np.full(N, P["v0"]); g = np.zeros(N); ref_until = np.zeros(N, dtype=np.int64)
ring = [np.zeros(0, dtype=np.int64) for _ in range(D)]
motor = {m["key"]: np.array(m["indices"]) for m in meta["motor"]}
steps_on, steps_total = int(args.on * 1000 / dt), int((args.on + args.off) * 1000 / dt)
win = int(100 / dt)
counts = np.zeros(N)
wcount = 0
for step in range(steps_total):
    slot = step % D
    spk = ring[slot]
    if len(spk):
        sub = W[spk]                      # rows of the spiking neurons
        np.add.at(g, sub.indices, sub.data)
    new = []
    if step < steps_on:
        fire = sidx[rng.random(len(sidx)) < p]
        v[fire] = P["vReset"]; g[fire] = 0
        new.append(fire)
    free = ref_until <= step
    vn = P["v0"] + (v - P["v0"]) * em + g * cg
    v = np.where(free, vn, v)
    g = np.where(free, g * eg, g)
    th = free & (v > P["vTh"])
    fired = np.nonzero(th)[0]
    v[fired] = P["vReset"]; g[fired] = 0; ref_until[fired] = step + R
    new.append(fired)
    allf = np.concatenate(new)
    ring[slot] = allf
    counts[allf] += 1
    wcount += len(allf)
    if (step + 1) % win == 0:
        t = (step + 1) * dt / 1000
        rates = {k: counts[ix].sum() / len(ix) / 0.1 for k, ix in motor.items()}
        print(f"t={t:.1f}s spikes={wcount:7d} ({wcount/0.1/1000:.1f}k/s) " + " ".join(f"{k}={r:.0f}" for k, r in rates.items()), flush=True)
        counts[:] = 0; wcount = 0
