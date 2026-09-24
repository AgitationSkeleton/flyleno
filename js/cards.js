// Full-screen cards for the stage screens during show segments (sponsor reads, commercial breaks,
// the space-scabies telethon, the campaign, technical difficulties). Each card is a canvas redrawn every
// frame; js/screens.js puts it on the screens and the fly sees it through its photoreceptors.
const W = 1024, H = 448;

function makeCanvas() { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; }

function fitText(ctx, text, maxW, size, font = 'Impact, "Arial Black", sans-serif', weight = '') {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${font}`; s -= 4; } while (ctx.measureText(text).width > maxW && s > 12);
}

const CARDS = {
  /** "this next bit is brought to you by our sponsor: Gronk" - with a throbbing logo. No strobing: the colours
   *  stay put and only a soft red glow swells about once a second (photosensitivity: nothing flashes) */
  gronk(ctx, t) {
    const beat = 0.5 - 0.5 * Math.cos(t * Math.PI * 2 * 0.9);            // 0..1, smooth, ~0.9 Hz
    ctx.fillStyle = '#2a0006'; ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W / 2, H / 2 + 20, 20, W / 2, H / 2 + 20, W * 0.6);
    glow.addColorStop(0, `rgba(170,0,26,${0.35 + 0.2 * beat})`); glow.addColorStop(1, 'rgba(170,0,26,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ff5a5a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    fitText(ctx, 'THIS BIT IS BROUGHT TO YOU BY', W * 0.9, 38); ctx.fillText('THIS BIT IS BROUGHT TO YOU BY', W / 2, 60);
    ctx.save(); ctx.translate(W / 2 + Math.sin(t * 5.3) * 4, H / 2 + 20 + Math.sin(t * 4.1) * 3);   // a slow wobble
    ctx.rotate(Math.sin(t * 2.3) * 0.025); const k = 1 + 0.04 * beat; ctx.scale(k, k);
    fitText(ctx, 'GRONK', W * 0.85, 230); ctx.fillStyle = '#f4e8e8'; ctx.fillText('GRONK', 0, 0);
    ctx.restore();
    ctx.fillStyle = '#ff8a8a'; fitText(ctx, 'our sponsor', W * 0.5, 34, 'Georgia, serif', 'italic');
    ctx.fillText('our sponsor', W / 2, H - 42);
  },
  /** "Buy these new Grey Leno NFTs" */
  nft(ctx, t) {
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, `hsl(${(t * 80) % 360},90%,55%)`); g.addColorStop(1, `hsl(${(t * 80 + 140) % 360},90%,45%)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    fitText(ctx, 'BUY GREY LENO NFTs', W * 0.9, 120); ctx.fillText('BUY GREY LENO NFTs', W / 2, H / 2 - 40);
    for (let k = 0; k < 6; k++) {                                 // tumbling alien heads
      const x = ((k * 190 + t * 160) % (W + 120)) - 60, y = H - 90 + Math.sin(t * 3 + k) * 20;
      ctx.fillStyle = '#9aa0a6'; ctx.beginPath(); ctx.ellipse(x, y, 40, 52, Math.sin(t + k) * 0.4, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(x - 16, y - 6, 12, 18, -0.4, 0, 6.3); ctx.ellipse(x + 16, y - 6, 12, 18, 0.4, 0, 6.3); ctx.fill();
    }
    ctx.fillStyle = '#ffffffcc'; fitText(ctx, 'each one 100% unique*', W * 0.5, 30, 'Georgia, serif', 'italic'); ctx.fillText('each one 100% unique*', W / 2, H / 2 + 50);
  },
  /** "find the cure for space scabies, which I definitely don't have" */
  telethon(ctx, t, s) {
    ctx.fillStyle = '#062b5c'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffd23f';
    fitText(ctx, 'SPACE SCABIES TELETHON', W * 0.9, 84); ctx.fillText('SPACE SCABIES TELETHON', W / 2, 70);
    ctx.fillStyle = '#fff'; fitText(ctx, '3 out of 4 Martians have the same problem', W * 0.8, 32, 'Georgia, serif', 'italic');
    ctx.fillText('3 out of 4 Martians have the same problem', W / 2, 140);
    s.total = (s.total || 0) + Math.random() * 40;
    ctx.fillStyle = '#39ff14'; fitText(ctx, '$' + Math.floor(s.total).toLocaleString(), W * 0.7, 150, '"Courier New", monospace', 'bold');
    ctx.fillText('$' + Math.floor(s.total).toLocaleString(), W / 2, 265);
    ctx.fillStyle = Math.floor(t * 2) % 2 ? '#ff5d5d' : '#ffffff';
    fitText(ctx, 'CALL NOW  1-800-LENO', W * 0.7, 46); ctx.fillText('CALL NOW  1-800-LENO', W / 2, 385);
  },
  /** "Vote Leno in the fall" */
  vote(ctx, t) {
    const stripe = H / 7;
    for (let k = 0; k < 7; k++) { ctx.fillStyle = k % 2 ? '#f5f5f5' : '#b22234'; ctx.fillRect(0, k * stripe, W, stripe); }
    ctx.fillStyle = '#1b2a6b'; ctx.fillRect(0, 0, W * 0.34, stripe * 4);
    ctx.fillStyle = '#fff';
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) { ctx.beginPath(); ctx.arc(28 + c * 55, 30 + r * 58, 9 + 3 * Math.sin(t * 4 + r + c), 0, 6.3); ctx.fill(); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const pulse = 1 + 0.05 * Math.sin(t * 5);
    ctx.save(); ctx.translate(W * 0.64, H * 0.42); ctx.scale(pulse, pulse);
    ctx.fillStyle = '#1b2a6b'; fitText(ctx, 'VOTE LENO', W * 0.6, 150); ctx.lineWidth = 10; ctx.strokeStyle = '#fff';
    ctx.strokeText('VOTE LENO', 0, 0); ctx.fillText('VOTE LENO', 0, 0); ctx.restore();
    ctx.fillStyle = '#1b2a6b'; fitText(ctx, 'feet will always be free', W * 0.9, 44, 'Georgia, serif', 'italic bold');
    ctx.fillText('feet will always be free', W / 2, H - 40);
  },
  /** technical difficulties: "Dave, can you fix the static?" (soft grey snow, redrawn ~12 times a second, so the
   *  picture shimmers rather than strobes) */
  static(ctx, t, s) {
    if (!s.img) s.img = ctx.createImageData(W / 4, H / 4);
    const frame = Math.floor(t * 12);
    if (frame !== s.frame) {
      s.frame = frame;
      const d = s.img.data;
      for (let i = 0; i < d.length; i += 4) { const v = 70 + Math.random() * 110; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    }
    ctx.putImageData(s.img, 0, 0); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(ctx.canvas, 0, 0, W / 4, H / 4, 0, 0, W, H);
    const roll = (t * 180) % H;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, roll, W, 40);
    if (Math.floor(t * 1.5) % 2 === 0) {
      ctx.fillStyle = '#000a'; ctx.fillRect(W * 0.18, H * 0.38, W * 0.64, H * 0.24);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      fitText(ctx, 'TECHNICAL DIFFICULTIES', W * 0.6, 60, '"Courier New", monospace', 'bold'); ctx.fillText('TECHNICAL DIFFICULTIES', W / 2, H / 2);
    }
  },
  /** "Hey everybody and welcome to the Grey Leno Show!" title card */
  title(ctx, t) {
    ctx.fillStyle = '#07070b'; ctx.fillRect(0, 0, W, H);
    for (let k = 0; k < 24; k++) {                                     // sunburst
      const a = k / 24 * 6.28 + t * 0.4;
      ctx.fillStyle = k % 2 ? '#2a0610' : '#4a0a1a';
      ctx.beginPath(); ctx.moveTo(W / 2, H / 2); ctx.arc(W / 2, H / 2, W, a, a + 6.28 / 24); ctx.fill();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8e8e8'; fitText(ctx, 'THE GREY LENO SHOW', W * 0.9, 110);
    ctx.lineWidth = 8; ctx.strokeStyle = '#000'; ctx.strokeText('THE GREY LENO SHOW', W / 2, H / 2 - 20); ctx.fillText('THE GREY LENO SHOW', W / 2, H / 2 - 20);
    ctx.fillStyle = '#ff4d6d'; fitText(ctx, 'a whole cavalcade of material, to your heart\'s consent', W * 0.8, 30, 'Georgia, serif', 'italic');
    ctx.fillText('a whole cavalcade of material, to your heart\'s consent', W / 2, H / 2 + 60);
  },
};

// The prize wheel: eight wedges in soft colours of about the same brightness (so the spinning pattern never
// flashes), at most about one turn a second, easing to a stop on the chosen prize under the pointer.
const WHEEL_COLORS = ['#c9828a', '#c99a6b', '#b5ad6a', '#86b07e', '#72aeb0', '#7f9cc4', '#9f8ac2', '#c083ad'];
function drawWheel(ctx, t, s) {
  const { labels = ['?'], pick = 0, spin = 6.5 } = s.opts || {};
  const n = labels.length, wedge = (Math.PI * 2) / n;
  // the pointer is at the top (angle -PI/2); wedge i spans [i*wedge, (i+1)*wedge) from the wheel's zero angle
  const base = -Math.PI / 2 - (pick + 0.5) * wedge;
  s.final ??= Math.PI * 4 + base - Math.PI * 2 * Math.floor(base / (Math.PI * 2));      // two full turns, then onto the prize
  const u = Math.min(1, t / spin), ang = s.final * (1 - (1 - u) * (1 - u));             // eases out: at most ~0.9 turns/s
  ctx.fillStyle = '#1d1a24'; ctx.fillRect(0, 0, W, H);
  const cx = W * 0.36, cy = H / 2, R = H * 0.44;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, ang + i * wedge, ang + (i + 1) * wedge); ctx.closePath(); ctx.fill();
    // labels read outward from the hub, turned round on the left half so they're never upside down
    const a = ang + (i + 0.5) * wedge, flip = Math.cos(a) < 0;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(flip ? a + Math.PI : a);
    ctx.fillStyle = '#2a2530'; ctx.textAlign = flip ? 'left' : 'right'; ctx.textBaseline = 'middle';
    fitText(ctx, labels[i], R * 0.62, 22, 'Impact, "Arial Black", sans-serif'); ctx.fillText(labels[i], flip ? -(R - 12) : R - 12, 0);
    ctx.restore();
  }
  ctx.fillStyle = '#e8e2d6'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8e2d6'; ctx.beginPath(); ctx.moveTo(cx - 16, cy - R - 14); ctx.lineTo(cx + 16, cy - R - 14); ctx.lineTo(cx, cy - R + 16); ctx.closePath(); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#e8e2d6';
  fitText(ctx, 'SPIN THE WHEEL', W * 0.34, 56); ctx.fillText('SPIN THE WHEEL', W * 0.79, H * 0.3);
  fitText(ctx, 'OF LENO', W * 0.3, 48); ctx.fillText('OF LENO', W * 0.79, H * 0.44);
  if (u >= 1) {
    ctx.fillStyle = '#f2d98a'; fitText(ctx, labels[pick], W * 0.34, 52); ctx.fillText(labels[pick], W * 0.79, H * 0.68);
  }
}
CARDS.wheel = drawWheel;

/** "I'm 500 years young, folks" */
CARDS.birthday = (ctx, t) => {
  ctx.fillStyle = '#2b1633'; ctx.fillRect(0, 0, W, H);
  for (let k = 0; k < 14; k++) {                                // slowly drifting balloons
    const x = (k * 83 + 40) % W, y = H + 40 - ((t * 22 + k * 53) % (H + 120));
    ctx.fillStyle = ['#c9828a', '#86b07e', '#7f9cc4', '#c99a6b'][k % 4];
    ctx.beginPath(); ctx.ellipse(x, y, 20, 25, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f3e3b0';
  fitText(ctx, 'HAPPY BIRTHDAY GREY LENO', W * 0.88, 72); ctx.fillText('HAPPY BIRTHDAY GREY LENO', W / 2, H * 0.38);
  ctx.fillStyle = '#e8d6ee'; fitText(ctx, '500 years young', W * 0.6, 44, 'Georgia, serif', 'italic');
  ctx.fillText('500 years young', W / 2, H * 0.62);
};

export function makeCard(kind, opts = null) {
  const canvas = makeCanvas(), ctx = canvas.getContext('2d'), state = { opts };
  const fn = CARDS[kind] || CARDS.title;
  return { kind, canvas, draw: (t) => fn(ctx, t, state) };
}
