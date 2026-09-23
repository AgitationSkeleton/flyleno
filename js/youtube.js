// Embedded YouTube music player (IFrame API) with custom controls.
// Hard-coded playlist; starts at "Masked Ball (1999 Extended Mix)" (index=23 in the playlist URL),
// then loops the playlist in shuffled order.
export const PLAYLIST = 'PLxqmDuD9PdVq2GjdlhaViQSRyxlmi0Uq4';
export const START_VIDEO = 'fHRLoVmPeLU';
export const START_INDEX = 23;

let apiPromise = null;
function loadApi() {
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

const fmt = (s) => (!isFinite(s) ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);

export class MusicPlayer {
  constructor(root) {
    this.root = root;
    this.ready = false;
    this.volume = 60;
    this.master = 1;                 // master volume factor from the viewport slider
    this.el = {
      title: root.querySelector('.yt-title'), play: root.querySelector('.yt-play'), prev: root.querySelector('.yt-prev'),
      next: root.querySelector('.yt-next'), seek: root.querySelector('.yt-seek'), time: root.querySelector('.yt-time'),
      vol: root.querySelector('.yt-vol'), back: root.querySelector('.yt-back'), fwd: root.querySelector('.yt-fwd'),
    };
    this.el.vol.value = this.volume;
  }

  async init() {
    const YT = await loadApi();
    await new Promise((resolve) => {
      this.player = new YT.Player(this.root.querySelector('.yt-frame'), {
        width: '100%', height: '200',
        videoId: START_VIDEO,
        playerVars: { list: PLAYLIST, listType: 'playlist', index: START_INDEX, loop: 1, playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
        events: {
          onReady: () => {
            this.ready = true; this.player.setVolume(this.volume * this.master);
            this.player.setLoop(true);                     // loop the whole playlist
            resolve();
          },
          onStateChange: (e) => {
            if (e.data === 1) {
              this.errors = 0;
              // shuffle once the playlist is loaded; the starting track keeps playing first
              if (!this.shuffled && this.player.getPlaylist()?.length) { this.player.setShuffle(true); this.player.setLoop(true); this.shuffled = true; }
            }
            if (e.data === 0) this.player.nextVideo();   // safety: keep going if the loop flag is ignored
            this.refreshTitle();
          },
          onError: (e) => {
            this.errors = (this.errors || 0) + 1;
            const why = { 2: 'bad request', 5: 'HTML5 player error', 100: 'video unavailable', 101: 'embedding disabled', 150: 'embedding disabled or referrer blocked', 153: 'missing referrer' }[e.data] || '';
            this.el.title.textContent = `YouTube error ${e.data} (${why})` + (this.errors < 4 ? ' — skipping' : '');
            if (this.errors < 4) setTimeout(() => this.player.nextVideo(), 1500);
          },
        },
      });
    });
    const P = this.player;
    this.el.play.onclick = () => (this.isPlaying ? P.pauseVideo() : P.playVideo());
    this.el.prev.onclick = () => P.previousVideo();
    this.el.next.onclick = () => P.nextVideo();
    this.el.back.onclick = () => P.seekTo(Math.max(0, P.getCurrentTime() - 10), true);
    this.el.fwd.onclick = () => P.seekTo(P.getCurrentTime() + 10, true);
    this.el.vol.oninput = (e) => { this.volume = +e.target.value; P.setVolume(this.volume * this.master); if (this.volume > 0) P.unMute(); };
    this.el.seek.oninput = (e) => { this.seeking = true; this.el.time.textContent = `${fmt(+e.target.value)} / ${fmt(P.getDuration())}`; };
    this.el.seek.onchange = (e) => { P.seekTo(+e.target.value, true); this.seeking = false; };
    setInterval(() => this.tick(), 250);
  }

  setMaster(f) { this.master = f; if (this.ready) this.player.setVolume(this.volume * f); }

  get isPlaying() { return this.ready && this.player.getPlayerState?.() === 1; }

  play() { if (this.ready) { this.player.unMute(); this.player.playVideo(); } }

  refreshTitle() {
    const d = this.player.getVideoData?.();
    if (d?.title) this.el.title.textContent = d.title + (d.author ? ` — ${d.author}` : '');
    this.el.play.textContent = this.isPlaying ? '❚❚' : '▶';
  }

  tick() {
    if (!this.ready) return;
    const P = this.player, dur = P.getDuration() || 0, cur = P.getCurrentTime() || 0;
    if (!this.seeking) {
      this.el.seek.max = dur; this.el.seek.value = cur;
      this.el.time.textContent = `${fmt(cur)} / ${fmt(dur)}`;
    }
    this.refreshTitle();
  }
}
