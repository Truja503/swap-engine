import { get } from './ui.js';

const glyphs = [
  'M58 8 C49 0 16 -2 9 9 C-1 28 15 31 34 36 C53 41 65 45 60 61 C56 77 20 79 5 67',
  'M3 3 L15 74 L33 25 L51 74 L63 3',
  'M3 74 L32 3 L61 74 M15 48 H49',
  'M6 74 V3 H35 C68 3 68 41 35 41 H6',
  'M58 8 C49 0 16 -2 9 9 C-1 28 15 31 34 36 C53 41 65 45 60 61 C56 77 20 79 5 67',
];
const columns = 5;
const lines = 6;
const samples = 20;
const total = 2900;
const lerp = (a: number, b: number, t: number) => a * (1 - t) + b * t;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };

function letterPoints() {
  return glyphs.map(shape => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', shape);
    const length = path.getTotalLength();
    // Split the A's independent crossbar into a separate segment.
    const split = shape.includes('M15 48') ? length - 34 : length;
    return Array.from({ length: lines }, (_, row) => {
      const crossbar = split < length && row === lines - 1;
      const segments = split < length ? lines - 1 : lines;
      return Array.from({ length: samples + 1 }, (_, step) => {
        const position = crossbar ? lerp(split + 0.001, length, step / samples) : (row + step / samples) / segments * split;
        return path.getPointAtLength(position);
      });
    });
  });
}

export function playOpening() {
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  if (media.matches) return;
  const canvas = get<HTMLCanvasElement>('opening');
  const field = get('sculpture');
  const context = canvas.getContext('2d');
  if (!context) return;
  const paint = context;
  const letters = letterPoints();
  let frame = 0;
  let start: number | undefined;

  function finish() {
    cancelAnimationFrame(frame);
    canvas.hidden = true;
    field.classList.remove('opening');
    media.removeEventListener('change', motionChanged);
    get('rail-onchain').removeEventListener('click', finish);
    get('rail-lightning').removeEventListener('click', finish);
  }

  function motionChanged() {
    if (media.matches) finish();
  }

  function draw(now: number) {
    start ??= now;
    const time = now - start;
    if (time >= total) { finish(); return; }
    const ratio = Math.min(devicePixelRatio, 2);
    const width = Math.round(field.clientWidth * ratio);
    const height = Math.round(field.clientHeight * ratio);
    if (!width || !height) { finish(); return; }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    paint.setTransform(width / 620, 0, 0, height / 276, 0, 0);
    paint.clearRect(0, 0, 620, 276);
    paint.save();
    if (time < 360) {
      paint.beginPath();
      paint.rect(0, 0, 79 + 464 * ease(time / 360), 276);
      paint.clip();
    }
    const wave = ease((time - 420) / 500);
    const morph = ease((time - 1120) / 1000);
    paint.globalAlpha = ease(time / 240) * (1 - ease((time - 2300) / 520));
    paint.strokeStyle = '#111';
    paint.lineCap = 'round';
    paint.lineJoin = 'round';
    paint.lineWidth = 1.45;
    for (let row = 0; row < lines; row++) {
      paint.beginPath();
      for (let column = 0; column < columns; column++) {
        for (let segment = 0; segment <= samples; segment++) {
          const u = (column + segment / samples) / columns;
          const sourceX = 79 + u * 462;
          const sourceY = 94 + row * 17 + wave * (
            17 * Math.sin(u * 13 - time * 0.006 + row * 0.56) +
            5 * Math.cos(u * 19 - time * 0.004 + row * 0.22)
          );
          const target = letters[column]![row]![segment]!;
          const x = lerp(sourceX, 125 + column * 77 + target.x, morph);
          const y = lerp(sourceY, 99 + target.y, morph);
          if (segment === 0 && (column === 0 || morph > 0)) paint.moveTo(x, y);
          else paint.lineTo(x, y);
        }
      }
      paint.stroke();
    }
    paint.restore();
    frame = requestAnimationFrame(draw);
  }

  field.classList.add('opening');
  canvas.hidden = false;
  media.addEventListener('change', motionChanged);
  get('rail-onchain').addEventListener('click', finish, { once: true });
  get('rail-lightning').addEventListener('click', finish, { once: true });
  frame = requestAnimationFrame(draw);
}
