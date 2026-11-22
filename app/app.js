'use strict';
/* SignalWache – Signalerkennung per Kamera. Keine Abhängigkeiten. */
const $ = id => document.getElementById(id);
const video = $('video'), roiEl = $('roi'), work = $('work'), wctx = work.getContext('2d', { willReadFrequently: true });

/* ---------- Einstellungen ---------- */
const DEF = { sound: 'siren', vol: 100, torch: true, interval: 2, sens: 3, repeat: true, vib: true, debug: false, zoom: 1,
              roi: { x: 0.42, y: 0.35, w: 0.16, h: 0.14 }, system: 'ks', rois: {} };
/* Je Signalsystem ein eigenes, gemerktes Messfeld: Ks = eine Lampe (klein, quadratisch), Hl = mehrere Lampen übereinander (hochkant) */
const PRESET = { ks: { x: 0.42, y: 0.35, w: 0.16, h: 0.14 }, hl: { x: 0.40, y: 0.26, w: 0.20, h: 0.36 } };
let S = Object.assign({}, DEF);
try { Object.assign(S, JSON.parse(localStorage.getItem('swt-settings') || '{}')); } catch (e) {}
if (S.rois && S.rois[S.system]) S.roi = { ...S.rois[S.system] };
const save = () => { S.rois = S.rois || {}; S.rois[S.system] = S.roi; try { localStorage.setItem('swt-settings', JSON.stringify(S)); } catch (e) {} };

/* ---------- Kamera ---------- */
let stream = null, facing = 'environment', track = null;
async function startCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  $('camError').hidden = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    video.srcObject = stream;
    video.classList.toggle('mirror', facing === 'user');
    track = stream.getVideoTracks()[0];
    await video.play().catch(() => {});
    setupZoom();
  } catch (err) {
    const app = !!(window.AndroidBridge && AndroidBridge.openSettings);
    $('camError').hidden = false;
    $('camError').innerHTML = '<div id="camMsg"></div><div class="cam-actions"><button id="camRetry" class="small">Erneut versuchen</button>' + (app ? '<button id="camSet" class="small">App-Einstellungen</button>' : '') + '</div>';
    $('camMsg').textContent = 'Kamera nicht verfügbar: ' + (err.message || err.name) + (app ? '. Bitte die Kamera-Erlaubnis geben (Erneut versuchen, oder in den App-Einstellungen unter Berechtigungen → Kamera).' : '. Bitte Kamerazugriff erlauben (HTTPS nötig).');
    $('camRetry').onclick = () => { if (window.AndroidBridge && AndroidBridge.requestCamera) AndroidBridge.requestCamera(); else startCamera(); };
    if (app) $('camSet').onclick = () => AndroidBridge.openSettings();
  }
}
function setupZoom() {
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  const row = $('zoomRow');
  if (caps.zoom) {
    $('zoom').min = caps.zoom.min; $('zoom').max = Math.min(caps.zoom.max, 10); $('zoom').step = caps.zoom.step || 0.1;
    $('zoom').value = Math.min(Math.max(S.zoom, caps.zoom.min), caps.zoom.max);
    row.hidden = false; applyZoom();
  } else row.hidden = true;
}
function applyZoom() {
  $('zoomV').textContent = (+$('zoom').value).toFixed(1) + '×';
  if (track && track.applyConstraints) track.applyConstraints({ advanced: [{ zoom: +$('zoom').value }] }).catch(() => {});
}
$('zoom').addEventListener('input', () => { S.zoom = +$('zoom').value; applyZoom(); save(); });
window.swRetryCamera = () => { if (!$('camError').hidden) startCamera(); };   // z. B. nach erteilter Erlaubnis oder Rückkehr aus den Einstellungen
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') window.swRetryCamera(); });
$('camBtn').onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; startCamera(); };

/* ---------- ROI: Anzeige, Verschieben, Größe, Pinch ---------- */
const MIN = 0.04; // minimale Kantenlänge (Anteil des Bildschirms)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function normRoi() {
  const r = S.roi;
  r.w = clamp(r.w, MIN, 1); r.h = clamp(r.h, MIN, 1);
  r.x = clamp(r.x, 0, 1 - r.w); r.y = clamp(r.y, 0, 1 - r.h);
}
function drawRoi() {
  normRoi();
  const W = innerWidth, H = innerHeight, r = S.roi;
  Object.assign(roiEl.style, { left: r.x * W + 'px', top: r.y * H + 'px', width: r.w * W + 'px', height: r.h * H + 'px' });
}
const pts = new Map(); let drag = null;
roiEl.addEventListener('pointerdown', e => {
  roiEl.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  $('hint').classList.add('gone');
  const corner = e.target.classList.contains('h') ? [...e.target.classList].find(c => ['tl', 'tr', 'bl', 'br'].includes(c)) : null;
  drag = { corner, sx: e.clientX, sy: e.clientY, r: { ...S.roi }, pinch: null };
  if (pts.size === 2) { const [a, b] = [...pts.values()]; drag.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), r: { ...S.roi } }; }
  e.preventDefault();
});
roiEl.addEventListener('pointermove', e => {
  if (!pts.has(e.pointerId) || !drag) return;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const W = innerWidth, H = innerHeight;
  if (pts.size >= 2 && drag.pinch) {
    const [a, b] = [...pts.values()]; const k = Math.hypot(a.x - b.x, a.y - b.y) / drag.pinch.d, p = drag.pinch.r;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    S.roi = { w: p.w * k, h: p.h * k, x: cx - p.w * k / 2, y: cy - p.h * k / 2 };
  } else {
    const dx = (e.clientX - drag.sx) / W, dy = (e.clientY - drag.sy) / H, o = drag.r, c = drag.corner;
    if (!c) S.roi = { ...o, x: o.x + dx, y: o.y + dy };
    else {
      let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
      if (c.includes('l')) x1 = clamp(o.x + dx, 0, x2 - MIN); else x2 = clamp(x2 + dx, x1 + MIN, 1);
      if (c[0] === 't') y1 = clamp(o.y + dy, 0, y2 - MIN); else y2 = clamp(y2 + dy, y1 + MIN, 1);
      S.roi = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
  }
  drawRoi();
});
const endPtr = e => { pts.delete(e.pointerId); if (pts.size === 0) { drag = null; save(); } else if (pts.size === 1) { const p = [...pts.values()][0]; drag = { corner: null, sx: p.x, sy: p.y, r: { ...S.roi }, pinch: null }; } };
roiEl.addEventListener('pointerup', endPtr); roiEl.addEventListener('pointercancel', endPtr);
addEventListener('resize', drawRoi);

/* ROI (Bildschirm) -> Videopixel, exakt unter Berücksichtigung von object-fit: cover (und Spiegelung der Frontkamera) */
function roiToVideo() {
  const vw = video.videoWidth, vh = video.videoHeight; if (!vw || !vh) return null;
  const W = innerWidth, H = innerHeight; if (!W || !H) return null;
  const scale = Math.max(W / vw, H / vh);
  const offX = (W - vw * scale) / 2, offY = (H - vh * scale) / 2;
  const r = S.roi; let left = r.x * W, right = (r.x + r.w) * W;
  if (facing === 'user') { const l = W - right; right = W - left; left = l; }
  let sx = (left - offX) / scale, sx2 = (right - offX) / scale;
  let sy = (r.y * H - offY) / scale, sy2 = ((r.y + r.h) * H - offY) / scale;
  sx = clamp(sx, 0, vw - 1); sy = clamp(sy, 0, vh - 1);
  sx2 = clamp(sx2, sx + 1, vw); sy2 = clamp(sy2, sy + 1, vh);
  return { sx, sy, sw: sx2 - sx, sh: sy2 - sy };
}

/* ---------- Farberkennung (HSV) ---------- */
/* Es zählen nur "leuchtende" Pixel (hohe Sättigung + Helligkeit). Gelb wird großzügig als Hue 19–72° erkannt.
   NACHT-MODUS (automatisch, wenn das Messfeld insgesamt dunkel ist): LEDs belichten die Kamera oft bis fast Weiß aus.
   Dann zählen auch beinahe weiße Pixel mit leichtem Farbstich – so werden z. B. Hl-Signale in der Nacht erkannt.
   MISCHFARBE: Sind Gelb UND Grün gleichzeitig leuchtend (Hl-/Hp2-Bilder), wird "both" gemeldet. */
function analyze() {
  const g = roiToVideo(); if (!g) return null;
  const long = 96, k = long / Math.max(g.sw, g.sh), cw = Math.max(4, Math.round(g.sw * k)), ch = Math.max(4, Math.round(g.sh * k));
  if (work.width !== cw || work.height !== ch) { work.width = cw; work.height = ch; }
  wctx.drawImage(video, g.sx, g.sy, g.sw, g.sh, 0, 0, cw, ch);
  const d = wctx.getImageData(0, 0, cw, ch).data, n = cw * ch;
  let sum = 0; for (let i = 0; i < d.length; i += 4) sum += Math.max(d[i], d[i + 1], d[i + 2]);
  const night = (sum / n / 255) < 0.30;
  const sMin = [0.55, 0.45, 0.36, 0.28, 0.20][S.sens - 1] * (night ? 0.8 : 1), vMin = [0.55, 0.45, 0.38, 0.30, 0.24][S.sens - 1];
  let R = 0, Y = 0, G = 0, W = 0;
  const ySat = Math.max(sMin, night ? 0.40 : 0.50);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), df = mx - mn;
    if (mx < vMin || df === 0) continue;
    const s = df / mx, hot = mx > 0.9 && mn > 0.7;
    if (hot) { W++; if (!night || s < 0.08) continue; }      // überstrahlt: tagsüber ignorieren, nachts nach Farbstich werten
    else if (s < sMin) continue;
    let h = mx === r ? ((gg - b) / df) % 6 : mx === gg ? (b - r) / df + 2 : (r - gg) / df + 4;
    h = (h * 60 + 360) % 360;
    if (h <= 18 || h >= 335) R++;
    else if (h <= 72) { if (hot || s >= ySat) Y++; }   // Gelb braucht kräftige Sättigung: Braun/Holz/Rost (Hue ~25-40°, s ~0.3) ist KEINE Lampe
    else if (h >= 73 && h <= 190) G++;
  }
  const HL = S.system === 'hl';   // Hl: mehrere kleinere Lampen im Feld, Gelb oft schwächer -> niedrigere Schwelle, Mischfarbe großzügiger
  const minPx = Math.max(3, n * [0.03, 0.02, 0.012, 0.008, 0.005][S.sens - 1] * (HL ? 0.7 : 1));
  const best = Math.max(R, Y, G);
  let c = 'none';
  if (best >= minPx) c = best === R ? 'red' : best === Y ? 'yellow' : 'green';
  const go = Math.max(Y, G);
  if (c === 'red' && go >= minPx && go >= 0.6 * R) c = Y >= G ? 'yellow' : 'green';   // Rot+Gelb/Grün gemischt -> Fahrt
  if ((c === 'yellow' || c === 'green') && Y >= minPx && G >= minPx && Math.min(Y, G) >= (HL ? 0.25 : 0.5) * Math.max(Y, G)) c = 'both';
  return { c, R, Y, G, W, n, night, lum: sum / n / 255 };
}

/* ---------- Audio (laut: Vollaussteuerung + Kompressor, Töne im 2–3 kHz-Bereich, der Dieselgeräusch durchdringt) ---------- */
let ac = null, bus = null;
function audio() {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 12; comp.attack.value = 0.002; comp.release.value = 0.1;
    bus = ac.createGain(); bus.gain.value = 1.6; bus.connect(comp); comp.connect(ac.destination);
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
function tone(f, t0, dur, type = 'sine', vol = 1) {
  const a = audio(), o = a.createOscillator(), g = a.createGain(), v = Math.pow(S.vol / 100, 0.8);
  o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, a.currentTime + t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v * vol), a.currentTime + t0 + 0.008);
  g.gain.setValueAtTime(Math.max(0.0002, v * vol), a.currentTime + t0 + Math.max(0.01, dur - 0.03));
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + t0 + dur);
  o.connect(g).connect(bus); o.start(a.currentTime + t0); o.stop(a.currentTime + t0 + dur + 0.05);
}
function speak(text, onFail) {
  if (!('speechSynthesis' in window)) return onFail();
  let started = false;
  const u = new SpeechSynthesisUtterance(text); u.lang = 'de-DE'; u.volume = 1; u.rate = 0.9; u.pitch = 1;
  const v = speechSynthesis.getVoices().find(x => /^de/i.test(x.lang)); if (v) u.voice = v;
  u.onstart = () => { started = true; }; u.onerror = () => { if (!started) onFail(); };
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
  setTimeout(() => speechSynthesis.speak(u), 60);
  setTimeout(() => { if (!started) { speechSynthesis.cancel(); onFail(); } }, 1500);   // kein Ton -> Sirene als Rückfall
}
function playSound(kind) {
  if (kind === 'siren') { for (let i = 0; i < 8; i++) { tone(i % 2 ? 2600 : 1900, i * 0.22, 0.22, 'square', 1); } }
  else if (kind === 'fanfare') { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { tone(f, i * 0.2, 0.55, 'square', 0.8); tone(f * 2, i * 0.2, 0.55, 'square', 0.5); }); tone(2093, 0.8, 0.5, 'square', 0.9); }
  else if (kind === 'bell') { for (let i = 0; i < 5; i++) [1100, 2200, 3300].forEach((f, j) => tone(f, i * 0.3, 0.45, 'square', 1 / (j + 1))); }
  else if (kind === 'warn') { for (let i = 0; i < 4; i++) tone(2400, i * 0.3, 0.16, 'square', 1); }
  else if (kind === 'voice') { speak('Signal Fahrt frei! Signal Fahrt frei!', () => playSound('siren')); tone(2200, 0, 0.25, 'square', 1); }
}
const vibrate = () => { if (S.vib && navigator.vibrate) navigator.vibrate([500, 120, 500, 120, 500, 120, 900]); };
let strobe = null;
function flash(on) {                                  // Taschenlampe als optischer Alarm (wo vom Gerät unterstützt)
  clearInterval(strobe); strobe = null;
  const t = track; if (!t || !t.getCapabilities || !t.getCapabilities().torch) return;
  const set = v => t.applyConstraints({ advanced: [{ torch: v }] }).catch(() => {});
  if (on && S.torch) { let s = false; strobe = setInterval(() => { s = !s; set(s); }, 250); } else set(false);
}

/* ---------- Wake Lock ---------- */
let wl = null;
async function lockScreen() { try { if ('wakeLock' in navigator) { wl = await navigator.wakeLock.request('screen'); $('wakeBadge').classList.add('on'); wl.addEventListener('release', () => $('wakeBadge').classList.remove('on')); } } catch (e) {} }
function unlockScreen() { if (wl) { wl.release().catch(() => {}); wl = null; } $('wakeBadge').classList.remove('on'); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && watching) lockScreen(); });

/* ---------- Wache (Zustandsautomat) ---------- */
const NAMES = { red: 'ROT', yellow: 'GELB', green: 'GRÜN', both: 'GRÜN+GELB', none: '–' };
/* Blinken erkennen (z. B. Ks: grün blinkend): mindestens 2x "aus -> an" derselben Farbe innerhalb von 4 s */
let edges = [], prevC = null;
function noteLit(c) {
  const now = Date.now(), lit = c === 'yellow' || c === 'green' || c === 'both';
  if (lit && prevC === 'none') edges.push({ t: now, c });
  edges = edges.filter(e => now - e.t < 4000); prevC = c;
}
const blinking = c => edges.filter(e => e.c === c).length >= 2;
const nm = c => NAMES[c] + (blinking(c) ? ' (blinkend)' : '') + (c === 'both' && S.system === 'ks' ? ' (für Ks ungewöhnlich – Messfeld prüfen)' : '');
const ICON = { yellow: '🟡', green: '🟢', both: '🟢🟡' };
let watching = false, armed = false, timer = null, cand = { c: null, n: 0 }, stable = 'none', alarming = false, alarmTimer = null, dismissed = false;

function setStatus(text, c) {
  $('status').textContent = text; $('status').dataset.state = c || 'idle';
  $('led').dataset.s = c || ''; roiEl.dataset.state = c || 'none';
}
function showMeter(r) { const m = $('meter'); m.hidden = !S.debug; if (S.debug && r) m.textContent = `R ${r.R} · G ${r.G} · Y ${r.Y} · weiß ${r.W} / ${r.n}px${r.night ? ' · Nacht' : ''}`; }

function tick() {
  if (!watching) return;
  const r = analyze(); let next = S.interval * 1000; if (r) logTick(r);
  if (r) {
    showMeter(r); noteLit(r.c);
    cand = (cand.c === r.c) ? { c: r.c, n: cand.n + 1 } : { c: r.c, n: 1 };
    if (r.c === 'red') {
      if (cand.n >= 2) { stable = 'red'; armed = true; if (alarming) stopAlarm(); setStatus('🔴 Signal ROT – Wache aktiv', 'red'); }
      else next = 150;
    } else if (r.c === 'yellow' || r.c === 'green' || r.c === 'both') {
      if (armed) {
        next = 150;                                   // schnelle Bestätigung (2 Messungen in Folge) gegen Flackern
        if (cand.n >= 2) { stable = r.c; trigger(r.c); next = 500; }
      } else if (!alarming) { setStatus(`${ICON[r.c]} Signal ${nm(r.c)} – warte auf ROT`, r.c); next = 500; }
    } else {                                           // nichts erkannt
      if (!alarming) setStatus(armed ? 'Kein Signal im Messfeld – Wache aktiv' : 'Kein Signal im Messfeld', null);
      next = 500;
    }
    if (alarming && r.c === 'red' && cand.n >= 2) stopAlarm();
  }
  timer = setTimeout(tick, next);
}

function trigger(c) {
  if (alarming) { setStatus(`${ICON[c]} Signal ${nm(c)} im Messfeld`, c === 'both' ? 'green' : c); return; }
  armed = false; alarming = true; dismissed = false; event('alarm', { c }); snap('alarm:' + c);
  const a = $('alarm'); a.hidden = false; a.dataset.c = c;
  $('alarmSub').textContent = `Messfeld zeigt ${nm(c)}`;
  setStatus(`${ICON[c]} Signal ${nm(c)} im Messfeld`, c === 'both' ? 'green' : c);
  flash(true);
  const fire = () => { playSound(S.sound); vibrate(); };
  fire(); if (S.repeat) alarmTimer = setInterval(fire, 3000);
}
function stopAlarm() {
  if (alarming) event('alarm_end');
  alarming = false; clearInterval(alarmTimer); alarmTimer = null; $('alarm').hidden = true; flash(false);
  if ('speechSynthesis' in window) speechSynthesis.cancel(); if (navigator.vibrate) navigator.vibrate(0);
}
/* Quittieren nur durch 1 s Gedrückthalten – verhindert versehentliches „Wegwischen“ im Halbschlaf/Schreck */
let holdT = null;
const holdStart = e => { e.preventDefault(); $('alarm').classList.add('hold'); clearTimeout(holdT);
  holdT = setTimeout(() => { $('alarm').classList.remove('hold'); stopAlarm(); if (watching) setStatus('Quittiert – Wache wird bei ROT wieder scharf', null); }, 1000); };
const holdEnd = () => { clearTimeout(holdT); $('alarm').classList.remove('hold'); };
$('alarm').addEventListener('pointerdown', holdStart);
['pointerup', 'pointerleave', 'pointercancel'].forEach(t => $('alarm').addEventListener(t, holdEnd));

function start() {
  audio(); event('start'); watching = true; armed = false; stable = 'none'; cand = { c: null, n: 0 }; edges = []; prevC = null;
  $('mainBtn').textContent = '■ WACHE STOPPEN'; $('mainBtn').className = 'main stop';
  $('hint').classList.add('gone'); setStatus('Suche Signal im Messfeld …', null);
  lockScreen(); tick();
}
function stop() {
  event('stop'); watching = false; armed = false; clearTimeout(timer); stopAlarm(); unlockScreen();
  $('mainBtn').textContent = '▶ WACHE STARTEN'; $('mainBtn').className = 'main start';
  setStatus('Bereit – Messfeld über das Signal legen', null); $('meter').hidden = true;
}
$('mainBtn').onclick = () => watching ? stop() : start();

/* ---------- Einstellungsmenü ---------- */
const sheet = $('sheet'), scrim = $('scrim');
function openSheet(o) { sheet.classList.toggle('open', o); scrim.hidden = !o; sheet.setAttribute('aria-hidden', !o); }
$('setBtn').onclick = () => openSheet(true); $('closeSheet').onclick = scrim.onclick = () => openSheet(false);
const SYSINFO = {
  ks: 'Ks: je Signalbild leuchtet eine Lampe (Rot, Grün, Gelb, auch blinkend). Messfeld klein über die Hauptlampe legen. Grün+Gelb zusammen gilt hier als ungewöhnlich (meist Zusatzanzeiger im Feld).',
  hl: 'Hl: mehrere Lampen übereinander, Grün+Gelb gleichzeitig ist ein normales Signalbild (wird als eigene Farbe gemeldet, nicht als „Gelb“). Messfeld hochkant über alle Lampen des Hauptsignals legen. Gelb wird auch bei schwächerem Leuchten erkannt.'
};
function syncUI() {
  document.querySelectorAll('#sysSeg button').forEach(b => b.classList.toggle('on', b.dataset.s === S.system));
  $('sysInfo').textContent = SYSINFO[S.system]; $('sysTag').textContent = S.system === 'hl' ? 'Hl' : 'Ks';
  $('sound').value = S.sound; $('vol').value = S.vol; $('interval').value = S.interval; $('sens').value = S.sens;
  $('torch').checked = S.torch; $('repeat').checked = S.repeat; $('vib').checked = S.vib; $('debug').checked = S.debug;
  $('volV').textContent = S.vol + ' %'; $('intV').textContent = (+S.interval).toFixed(1) + ' s';
  $('sensV').textContent = ['sehr niedrig', 'niedrig', 'normal', 'hoch', 'sehr hoch'][S.sens - 1];
}
const bind = (id, key, conv = v => v, ev = 'input') => $(id).addEventListener(ev, e => { S[key] = conv(e.target.type === 'checkbox' ? e.target.checked : e.target.value); syncUI(); save(); });
bind('sound', 'sound'); bind('vol', 'vol', Number); bind('interval', 'interval', Number); bind('sens', 'sens', Number);
bind('torch', 'torch', Boolean, 'change'); bind('repeat', 'repeat', Boolean, 'change'); bind('vib', 'vib', Boolean, 'change'); bind('debug', 'debug', Boolean, 'change');
$('sound').addEventListener('change', () => playSound(S.sound));
$('testBtn').onclick = () => { playSound(S.sound); vibrate(); flash(true); setTimeout(() => flash(false), 1500); };
$('resetRoi').onclick = () => { S.roi = { ...PRESET[S.system] }; drawRoi(); save(); };
function setSystem(sys) {
  if (sys === S.system) return;
  S.rois[S.system] = S.roi; S.system = sys; S.roi = S.rois[sys] ? { ...S.rois[sys] } : { ...PRESET[sys] };
  edges = []; prevC = null; cand = { c: null, n: 0 }; if (watching) { armed = false; setStatus('Systemwechsel – suche Signal im Messfeld …', null); }
  drawRoi(); syncUI(); save(); if (typeof event === 'function') event('system', { s: sys });
}
document.querySelectorAll('#sysSeg button').forEach(b => b.addEventListener('click', () => setSystem(b.dataset.s)));


/* =====================================================================
   TESTVERSION – AUFZEICHNUNG
   Speichert alle Messwerte (inkl. Farb-Histogramm), Ereignisse und kleine Messfeld-/Szenenbilder
   lokal in IndexedDB (funkloch-sicher). Export als JSON per Teilen-Button (z. B. OneDrive/WhatsApp).
   ===================================================================== */
const SID = new Date().toISOString().replace(/[:.]/g, '-');
let buf = [], nRows = 0, nFrames = 0, nBytes = 0, lastSnap = 0, lastRaw = null;
const dbp = new Promise(res => {
  try { const q = indexedDB.open('swt-log', 1); q.onupgradeneeded = () => q.result.createObjectStore('c', { autoIncrement: true });
        q.onsuccess = () => res(q.result); q.onerror = () => res(null); } catch (e) { res(null); }
});
async function dbPut(o) { const db = await dbp; if (db) db.transaction('c', 'readwrite').objectStore('c').add(o); }
async function dbAll() { const db = await dbp; return db ? new Promise(r => { const q = db.transaction('c').objectStore('c').getAll(); q.onsuccess = () => r(q.result); q.onerror = () => r([]); }) : []; }
async function dbClear() { const db = await dbp; if (db) db.transaction('c', 'readwrite').objectStore('c').clear(); }
const r3 = v => Math.round(v * 1000) / 1000;
function record(row) { row.t = Date.now(); row.roi = [r3(S.roi.x), r3(S.roi.y), r3(S.roi.w), r3(S.roi.h)]; buf.push(row); nRows++; updRec(); }
function event(ev, extra) { record(Object.assign({ ev }, extra || {})); flush(); }
function flush() { if (!buf.length) return; const rows = buf; buf = []; nBytes += JSON.stringify(rows).length; dbPut({ k: 'e', sid: SID, rows }); }
setInterval(flush, 5000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
function snap(why) {                       // ROI-Bild (96 px, was die Erkennung wirklich sieht) + Gesamtbild (320 px)
  try {
    if (!work.width || !video.videoWidth) return;
    const roiImg = work.toDataURL('image/jpeg', 0.85);
    const sc = document.createElement('canvas'); sc.width = 320; sc.height = Math.round(320 * video.videoHeight / video.videoWidth);
    sc.getContext('2d').drawImage(video, 0, 0, sc.width, sc.height);
    const scene = sc.toDataURL('image/jpeg', 0.6);
    nFrames++; nBytes += roiImg.length + scene.length; lastSnap = Date.now();
    dbPut({ k: 'f', sid: SID, t: Date.now(), why, roi: [r3(S.roi.x), r3(S.roi.y), r3(S.roi.w), r3(S.roi.h)], roiImg, scene }); updRec();
  } catch (e) {}
}
function updRec() { $('rec').textContent = `● REC  ${nRows} Messungen · ${nFrames} Bilder · ${(nBytes / 1048576).toFixed(1)} MB`; }

/* Hue-Histogramm (12 Klassen à 30°) über alle halbwegs farbigen, hellen Pixel – Rohmaterial fürs Kalibrieren */
function hueHist() {
  const d = wctx.getImageData(0, 0, work.width, work.height).data, hb = new Array(12).fill(0);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, g, b), df = mx - Math.min(r, g, b);
    if (mx < 0.2 || df / mx < 0.15) continue;
    let h = mx === r ? ((g - b) / df) % 6 : mx === g ? (b - r) / df + 2 : (r - g) / df + 4; h = (h * 60 + 360) % 360;
    hb[Math.floor(h / 30) % 12]++;
  }
  return hb;
}
function logTick(r) {
  record({ sys: S.system, c: r.c, R: r.R, Y: r.Y, G: r.G, W: r.W, n: r.n, night: r.night ? 1 : 0, lum: r3(r.lum), hb: hueHist(), armed: armed ? 1 : 0, alarm: alarming ? 1 : 0 });
  if (r.c !== lastRaw && Date.now() - lastSnap > 2000) snap('wechsel:' + (lastRaw || '-') + '>' + r.c);
  else if (Date.now() - lastSnap > 15000) snap('periodisch');
  lastRaw = r.c;
}

/* Wahrheits-Markierung: Kollege drückt, was das Signal in Wirklichkeit zeigt */
document.querySelectorAll('#labels button').forEach(b => b.addEventListener('click', () => {
  event('label', { label: b.dataset.l }); snap('label:' + b.dataset.l);
  const t = $('labelToast'); t.textContent = 'Gespeichert: ' + b.textContent; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1200);
  if (navigator.vibrate) navigator.vibrate(30);
}));

/* Export */
async function exportLog() {
  flush(); await new Promise(r => setTimeout(r, 300));
  const chunks = await dbAll(), rows = [], frames = [];
  chunks.forEach(c => c.k === 'e' ? rows.push(...c.rows.map(x => Object.assign({ sid: c.sid }, x))) : frames.push(c));
  const st = track && track.getSettings ? track.getSettings() : {};
  const meta = { app: 'SignalWache-TEST-1', exported: new Date().toISOString(), ua: navigator.userAgent, screen: [screen.width, screen.height, devicePixelRatio],
    window: [innerWidth, innerHeight], video: [video.videoWidth, video.videoHeight], track: st, facing, settings: S,
    hueBins: '12 Klassen à 30° ab 0°=Rot; hb[0]=0-30° (Rot/Orange), hb[1]=30-60 (Gelb), hb[2]=60-90, hb[3]=90-120 (Grün) …' };
  const json = JSON.stringify({ meta, rows, frames });
  const name = `signalwache-log-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'SignalWache Log' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
$('exportBtn').onclick = exportLog;
$('exportBtn2').onclick = exportLog;
$('clearLog').onclick = async () => { if (confirm('Gesamtes Log auf diesem Gerät löschen?')) { await dbClear(); buf = []; nRows = nFrames = nBytes = 0; updRec(); } };
$('consentOk').onclick = () => { $('consent').hidden = true; event('session', { ua: navigator.userAgent, win: [innerWidth, innerHeight], settings: S }); };
dbAll().then(cs => { cs.forEach(c => { nBytes += JSON.stringify(c).length; if (c.k === 'e') nRows += c.rows.length; else nFrames++; }); updRec(); });

/* ---------- Start ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
syncUI(); drawRoi(); startCamera();
