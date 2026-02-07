/**
 * Generates a shareable "blink card" image.
 *
 * Loads the template (1200×675), then scatters 👁️ emojis randomly
 * across the white area (avoiding the bottom branding bar).
 * No cap — every blink gets its own emoji.
 */

/** Seeded PRNG for reproducible scatter per blink count */
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

export async function generateBlinkCard(blinkCount: number): Promise<Blob> {
  const WIDTH = 1200;
  const HEIGHT = 675;

  // Bottom branding bar starts at roughly y = 580
  const SAFE_BOTTOM = 560;
  const PADDING = 30;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;

  // Load and draw template
  const template = await loadImage('/blink-card-template.png');
  ctx.drawImage(template, 0, 0, WIDTH, HEIGHT);

  // Scale emoji size based on count
  let fontSize: number;
  if (blinkCount <= 10) fontSize = 48;
  else if (blinkCount <= 30) fontSize = 40;
  else if (blinkCount <= 60) fontSize = 32;
  else if (blinkCount <= 100) fontSize = 26;
  else if (blinkCount <= 200) fontSize = 20;
  else if (blinkCount <= 500) fontSize = 14;
  else fontSize = 10;

  const emoji = '👁️';
  const rand = seededRandom(blinkCount + 42);

  ctx.font = `${fontSize}px serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  // Collision avoidance — minimum distance between emoji centers
  const minDist = fontSize * 0.65;
  const placed: { x: number; y: number }[] = [];

  const areaW = WIDTH - 2 * PADDING;
  const areaH = SAFE_BOTTOM - 2 * PADDING;

  for (let i = 0; i < blinkCount; i++) {
    let x: number, y: number;
    let attempts = 0;
    const maxAttempts = Math.min(80, Math.max(10, 5000 / blinkCount));

    do {
      x = PADDING + rand() * areaW;
      y = PADDING + rand() * areaH;
      attempts++;
    } while (
      attempts < maxAttempts &&
      placed.some((p) => Math.hypot(p.x - x, p.y - y) < minDist)
    );

    placed.push({ x, y });

    // Slight random rotation for organic feel
    const angle = (rand() - 0.5) * 0.5;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillText(emoji, 0, 0);
    ctx.restore();
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to generate blink card image'));
      },
      'image/png',
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
