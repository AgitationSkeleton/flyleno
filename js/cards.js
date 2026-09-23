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
  /** "this next bit is brought to you by our sponsor: Gronk" - with a strobing logo */
  gronk(ctx, t) {
    const on = Math.floor(t * 6) % 2 === 0;
    ctx.fillStyle = on ? '#120000' : '#c3001a'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = on ? '#ff2a2a' : '#1a0000'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    fitText(ctx, 'THIS BIT IS BROUGHT TO YOU BY', W * 0.9, 38); ctx.fillText('THIS BIT IS BROUGHT TO YOU BY', W / 2, 60);
    ctx.save(); ctx.translate(W / 2 + (Math.random() - 0.5) * 14, H / 2 + 20 + (Math.random() - 0.5) * 10);
    ctx.rotate((Math.random() - 0.5) * 0.06);
    fitText(ctx, 'GRONK', W * 0.85, 230); ctx.fillStyle = on ? '#ffffff' : '#000000'; ctx.fillText('GRONK', 0, 0);
    ctx.restore();
    ctx.fillStyle = on ? '#ff7070' : '#300000'; fitText(ctx, 'our sponsor', W * 0.5, 34, 'Georgia, serif', 'italic');
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
  /** technical difficulties: "Dave, can you fix the static?" */
  static(ctx, t, s) {
    if (!s.img) s.img = ctx.createImageData(W / 4, H / 4);
    const d = s.img.data;
    for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
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

export function makeCard(kind) {
  const canvas = makeCanvas(), ctx = canvas.getContext('2d'), state = {};
  const fn = CARDS[kind] || CARDS.title;
  return { kind, canvas, draw: (t) => fn(ctx, t, state) };
}
