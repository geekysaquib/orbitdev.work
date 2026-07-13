// Draws the ORBIT brand mark — a filled core dot + one tilted ellipse ring,
// matching the exact geometry used everywhere else in the product
// (src/lib/icons.tsx "orbit" icon, the topbar/login logo, and the
// transactional-email header: circle r=3.1 + ellipse rx=10 ry=4.3 rotate(-26),
// in a 24-unit viewBox, color #37DFA0) — not a bespoke desktop-only design.
// Rendered at the standard Windows icon sizes and packed into orbit.ico.
// Pure JS (pngjs + png-to-ico) — no native image toolchain required to build.

import { PNG } from "pngjs";
import pngToIco from "png-to-ico";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const BG = [10, 11, 13]; // #0A0B0D
const GREEN = [55, 223, 160]; // #37DFA0

// Same 24-unit viewBox proportions as src/lib/icons.tsx's "orbit" icon.
const VB = 24;
const CORE_R = 3.1;
const RING_RX = 10;
const RING_RY = 4.3;
const RING_ANGLE_DEG = -26;
const RING_STROKE = 1.7;

function drawIcon(size) {
  const png = new PNG({ width: size, height: size });
  const cx = size / 2;
  const cy = size / 2;
  const cornerR = size * 0.22;
  const scale = size / VB;

  const coreR = CORE_R * scale;
  const ringA = RING_RX * scale;
  const ringB = RING_RY * scale;
  // Stays crisp at 16-24px, matches spec proportion at large sizes.
  const ringWidth = Math.max(1.3, RING_STROKE * scale);
  const ang = (RING_ANGLE_DEG * Math.PI) / 180;
  const cosA = Math.cos(ang);
  const sinA = Math.sin(ang);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;

      if (!insideRoundedSquare(x + 0.5, y + 0.5, size, cornerR)) {
        png.data[idx + 3] = 0;
        continue;
      }
      png.data[idx] = BG[0];
      png.data[idx + 1] = BG[1];
      png.data[idx + 2] = BG[2];
      png.data[idx + 3] = 255;

      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;

      // Tilted ellipse ring.
      const rx = dx * cosA - dy * sinA;
      const ry = dx * sinA + dy * cosA;
      const ringDist = Math.hypot(rx / ringA, ry / ringB);
      if (Math.abs(ringDist - 1) < ringWidth / ringA) {
        blend(png.data, idx, GREEN, 1);
      }

      // Filled core dot.
      if (Math.hypot(dx, dy) < coreR) {
        blend(png.data, idx, GREEN, 1);
      }
    }
  }
  return PNG.sync.write(png);
}

function insideRoundedSquare(x, y, size, r) {
  const nx = x < r ? r : x > size - r ? size - r : x;
  const ny = y < r ? r : y > size - r ? size - r : y;
  if (x >= r && x <= size - r) return y >= 0 && y <= size;
  if (y >= r && y <= size - r) return x >= 0 && x <= size;
  return Math.hypot(x - nx, y - ny) <= r;
}

function blend(data, idx, color, alpha) {
  data[idx] = Math.round(data[idx] * (1 - alpha) + color[0] * alpha);
  data[idx + 1] = Math.round(data[idx + 1] * (1 - alpha) + color[1] * alpha);
  data[idx + 2] = Math.round(data[idx + 2] * (1 - alpha) + color[2] * alpha);
  data[idx + 3] = 255;
}

export { drawIcon };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pngBuffers = SIZES.map(drawIcon);
  const ico = await pngToIco(pngBuffers);
  const outPath = join(__dir, "orbit.ico");
  writeFileSync(outPath, ico);
  console.log("[icon] wrote", outPath);
}
