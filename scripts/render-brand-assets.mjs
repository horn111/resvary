import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const brandDirectory = path.join(repositoryRoot, 'assets', 'brand');

const palette = {
  canvas: '#0a0a0a',
  ink: '#f2f2f0',
};

function lockedMark({ x, y, width, id }) {
  // Canonical Resvary mark. These profiles mirror buildHeroCanvas() exactly.
  // Do not alter the path geometry without an explicit brand decision.
  const height = width / 2.48;
  const lineWidth = Math.max(2.5, Math.min(5.5, width * 0.0103));
  const nodeRadius = Math.max(15, Math.min(25, width * 0.048));
  const nodeX = x + width * 0.532;
  const nodeY = y + height * 0.602;

  const upper = [
    `M ${x + width * 0.1} ${y}`,
    `L ${x + width * 0.35} ${y}`,
    `C ${x + width * 0.51} ${y}, ${x + width * 0.51} ${y + height * 0.68}, ${x + width * 0.65} ${y + height * 0.68}`,
    `L ${x + width} ${y + height * 0.68}`,
  ].join(' ');
  const lower = [
    `M ${x} ${y + height * 0.31}`,
    `L ${x + width * 0.28} ${y + height * 0.31}`,
    `C ${x + width * 0.37} ${y + height * 0.31}, ${x + width * 0.37} ${y + height}, ${x + width * 0.58} ${y + height}`,
    `L ${x + width * 0.88} ${y + height}`,
  ].join(' ');

  return `
    <defs>
      <linearGradient id="${id}-upper" gradientUnits="userSpaceOnUse" x1="${x + width * 0.1}" x2="${x + width}">
        <stop offset="0" stop-color="${palette.ink}" stop-opacity="0"/>
        <stop offset="0.085" stop-color="${palette.ink}" stop-opacity="0.5"/>
        <stop offset="0.915" stop-color="${palette.ink}" stop-opacity="0.5"/>
        <stop offset="1" stop-color="${palette.ink}" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="${id}-lower" gradientUnits="userSpaceOnUse" x1="${x}" x2="${x + width * 0.88}">
        <stop offset="0" stop-color="${palette.ink}" stop-opacity="0"/>
        <stop offset="0.085" stop-color="${palette.ink}" stop-opacity="0.5"/>
        <stop offset="0.915" stop-color="${palette.ink}" stop-opacity="0.5"/>
        <stop offset="1" stop-color="${palette.ink}" stop-opacity="0"/>
      </linearGradient>
      <filter id="${id}-node-glow" x="-250%" y="-250%" width="500%" height="500%">
        <feGaussianBlur stdDeviation="9"/>
      </filter>
    </defs>
    <g id="resvary-locked-mark" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="${upper}" stroke="url(#${id}-upper)" stroke-width="${lineWidth}"/>
      <path d="${lower}" stroke="url(#${id}-lower)" stroke-width="${lineWidth}"/>
      <circle cx="${nodeX}" cy="${nodeY}" r="${nodeRadius * 1.08}" fill="#fff" opacity="0.32" filter="url(#${id}-node-glow)" stroke="none"/>
      <circle cx="${nodeX}" cy="${nodeY}" r="${nodeRadius}" fill="#fff" stroke="none"/>
    </g>`;
}

function canvas({ width, height, content, glowX = '50%', glowY = '50%' }) {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <radialGradient id="background-glow" cx="${glowX}" cy="${glowY}" r="58%">
          <stop offset="0" stop-color="#fff" stop-opacity="0.055"/>
          <stop offset="0.55" stop-color="#fff" stop-opacity="0.018"/>
          <stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="${palette.canvas}"/>
      <rect width="100%" height="100%" fill="url(#background-glow)"/>
      ${content}
    </svg>`;
}

const textStyle = `font-family="Archivo, Helvetica Neue, Arial, sans-serif" font-weight="500" fill="${palette.ink}" letter-spacing="-0.038em"`;

const assets = [
  {
    filename: 'resvary-x-avatar.png',
    width: 800,
    height: 800,
    svg: canvas({
      width: 800,
      height: 800,
      content: lockedMark({ x: 100, y: 287, width: 600, id: 'avatar' }),
    }),
  },
  {
    filename: 'resvary-x-header-clean.png',
    width: 1500,
    height: 500,
    svg: canvas({
      width: 1500,
      height: 500,
      content: lockedMark({ x: 465, y: 139, width: 570, id: 'header-clean' }),
    }),
  },
  {
    filename: 'resvary-x-header.png',
    width: 1500,
    height: 500,
    svg: canvas({
      width: 1500,
      height: 500,
      content: `
        <text x="54" y="115" font-size="76" ${textStyle}>Resvary.</text>
        ${lockedMark({ x: 475, y: 139, width: 550, id: 'header' })}
        <text x="1446" y="372" font-size="66" text-anchor="end" ${textStyle}>
          <tspan x="1446" dy="0">credits</tspan>
          <tspan x="1446" dy="0.96em">for AI</tspan>
        </text>`,
    }),
  },
  {
    filename: 'resvary-rebrand-announcement.png',
    width: 1600,
    height: 900,
    svg: canvas({
      width: 1600,
      height: 900,
      content: `
        <text x="92" y="188" font-size="94" ${textStyle}>Resvary.</text>
        ${lockedMark({ x: 480, y: 328, width: 640, id: 'announcement' })}
        <text x="1508" y="684" font-size="78" text-anchor="end" ${textStyle}>
          <tspan x="1508" dy="0">New name.</tspan>
          <tspan x="1508" dy="0.96em">Same focus.</tspan>
        </text>`,
    }),
  },
];

await Promise.all(
  assets.map(({ filename, width, height, svg }) =>
    sharp(Buffer.from(svg))
      .resize(width, height)
      .png({ compressionLevel: 9 })
      .toFile(path.join(brandDirectory, filename)),
  ),
);

for (const { filename, width, height } of assets) {
  console.log(`${filename}: ${width} × ${height}`);
}
