'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { InteractiveCreditDemo } from './interactive-credit-demo';

type PointerState = { x: number; y: number; on: boolean };
type Dot = { x: number; y: number; u: number; r?: number };
type Particle = { bx: number; by: number; x: number; y: number; vx: number; vy: number };
type Point = { x: number; y: number };
type RailProfile = {
  startX: number;
  straightEndX: number;
  controlX: number;
  curveEndX: number;
  endX: number;
  startY: number;
  endY: number;
};

export function ClaudeDesignController() {
  const [demoTarget, setDemoTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-resvary-page]');
    if (!root) return;
    setDemoTarget(root.querySelector<HTMLElement>('[data-claude-demo-root]'));

    const byRef = <T extends HTMLElement>(name: string) =>
      root.querySelector<T>(`[data-claude-ref="${name}"]`);
    const heroCanvas = byRef<HTMLCanvasElement>('setCanvas');
    const footerCanvas = byRef<HTMLCanvasElement>('setFooterCanvas');
    const heroHeading = root.querySelector<HTMLElement>('#top h1');
    const header = byRef<HTMLElement>('setHeader');
    const progress = byRef<HTMLElement>('setProgress');
    const paper = byRef<HTMLElement>('setPaper');
    const printButton = root.querySelector<HTMLButtonElement>('button[data-claude-print]');
    const copyButton = byRef<HTMLButtonElement>('setCopyBtn');
    const code = byRef<HTMLElement>('setCode');
    const printLine = byRef<HTMLElement>('setPrintLine');
    const spinner = byRef<HTMLElement>('setSpinner');
    const doneMark = byRef<HTMLElement>('setDoneMark');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cleanup: Array<() => void> = [];
    const timers: number[] = [];
    const heroPointer: PointerState = { x: -9999, y: -9999, on: false };
    const footerPointer: PointerState = { x: -9999, y: -9999, on: false };
    let heroRender: ((now: number) => boolean) | null = null;
    let footerRender: (() => boolean) | null = null;
    let raf = 0;
    let scrollRaf = 0;
    let heroVisible = false;
    let footerVisible = false;
    let loopRunning = false;
    let paperAnimation: Animation | null = null;

    const hoverElements = [...root.querySelectorAll<HTMLElement>('[data-hover-style]')];
    for (const element of hoverElements) {
      const baseStyle = element.getAttribute('style') ?? '';
      const hoverStyle = element.dataset.hoverStyle ?? '';
      const enter = () => element.setAttribute('style', `${baseStyle};${hoverStyle}`);
      const leave = () => element.setAttribute('style', baseStyle);
      element.addEventListener('pointerenter', enter);
      element.addEventListener('pointerleave', leave);
      cleanup.push(() => {
        element.removeEventListener('pointerenter', enter);
        element.removeEventListener('pointerleave', leave);
      });
    }

    const mobileMenu = root.querySelector<HTMLDetailsElement>('[data-mobile-nav]');
    const closeMobileMenu = (event: Event) => {
      if ((event.target as Element).closest('a')) mobileMenu?.removeAttribute('open');
    };
    const closeMobileMenuWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') mobileMenu?.removeAttribute('open');
    };
    mobileMenu?.addEventListener('click', closeMobileMenu);
    mobileMenu?.addEventListener('keydown', closeMobileMenuWithEscape);
    cleanup.push(() => {
      mobileMenu?.removeEventListener('click', closeMobileMenu);
      mobileMenu?.removeEventListener('keydown', closeMobileMenuWithEscape);
    });

    const paint = (now = performance.now(), force = false) => {
      const heroAnimating = force || heroVisible ? (heroRender?.(now) ?? false) : false;
      const footerAnimating = force || footerVisible ? (footerRender?.() ?? false) : false;
      return { heroAnimating, footerAnimating };
    };

    const loop = (now: number) => {
      const { heroAnimating, footerAnimating } = paint(now);
      if ((heroVisible && heroAnimating) || (footerVisible && footerAnimating)) {
        raf = window.requestAnimationFrame(loop);
      } else {
        loopRunning = false;
      }
    };

    const startLoop = () => {
      if (reducedMotion || loopRunning || (!heroVisible && !footerVisible)) return;
      loopRunning = true;
      raf = window.requestAnimationFrame(loop);
    };

    const attachPointer = (canvas: HTMLCanvasElement | null, pointer: PointerState) => {
      if (!canvas || reducedMotion) return;
      const move = (event: PointerEvent) => {
        pointer.x = event.offsetX;
        pointer.y = event.offsetY;
        pointer.on = true;
        startLoop();
      };
      const leave = () => {
        pointer.on = false;
        startLoop();
      };
      canvas.addEventListener('pointermove', move, { passive: true });
      canvas.addEventListener('pointerleave', leave);
      cleanup.push(() => {
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerleave', leave);
      });
    };
    attachPointer(heroCanvas, heroPointer);
    attachPointer(footerCanvas, footerPointer);

    const updateScroll = () => {
      scrollRaf = 0;
      const documentElement = document.documentElement;
      const maximum = Math.max(1, documentElement.scrollHeight - window.innerHeight);
      const ratio = Math.min(1, Math.max(0, window.scrollY / maximum));
      if (progress) progress.style.transform = `scaleX(${ratio})`;
      if (header) {
        header.style.borderBottomColor = window.scrollY > 12 ? 'var(--color-line)' : 'transparent';
      }
    };
    const queueScrollUpdate = () => {
      if (!scrollRaf) scrollRaf = window.requestAnimationFrame(updateScroll);
    };
    window.addEventListener('scroll', queueScrollUpdate, { passive: true });
    updateScroll();
    cleanup.push(() => {
      window.removeEventListener('scroll', queueScrollUpdate);
      window.cancelAnimationFrame(scrollRaf);
    });

    if (!reducedMotion && typeof IntersectionObserver === 'function') {
      const revealElements = [...root.querySelectorAll<HTMLElement>('[data-reveal]')];
      const reveal = (element: HTMLElement) => {
        element.style.opacity = '1';
        element.style.transform = 'none';
      };
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            reveal(entry.target as HTMLElement);
            observer.unobserve(entry.target);
          }
        },
        { rootMargin: '0px 0px -12% 0px', threshold: 0.06 },
      );
      const positions = revealElements.map((element) => ({
        element,
        aboveFold: element.getBoundingClientRect().top < window.innerHeight * 0.9,
      }));
      for (const { element, aboveFold } of positions) {
        element.style.transition = 'opacity .7s ease, transform .7s cubic-bezier(.2,.7,.2,1)';
        if (aboveFold) continue;
        element.style.opacity = '0';
        element.style.transform = 'translateY(22px)';
        observer.observe(element);
      }
      const safety = window.setTimeout(() => revealElements.forEach(reveal), 2500);
      cleanup.push(() => {
        observer.disconnect();
        window.clearTimeout(safety);
      });
    }

    const setPrintLabel = (text: string, done: boolean) => {
      if (printLine) printLine.textContent = text;
      if (spinner) spinner.style.display = done ? 'none' : 'block';
      if (doneMark) doneMark.style.display = done ? 'block' : 'none';
    };
    const runPrint = () => {
      if (!paper) return;
      for (const timer of timers.splice(0)) window.clearTimeout(timer);
      paperAnimation?.cancel();
      paperAnimation = null;
      paper.style.animation = 'none';
      paper.style.transform = 'translateY(-101%)';
      if (reducedMotion) {
        paper.style.transform = 'translateY(-1%)';
        setPrintLabel('Receipt complete', true);
        return;
      }
      setPrintLabel('Reserving credits', false);
      const at = (delay: number, callback: () => void) =>
        timers.push(window.setTimeout(callback, delay));
      at(700, () => setPrintLabel('Charging actual usage', false));
      at(1400, () => setPrintLabel('Releasing the remainder', false));
      at(2000, () => {
        setPrintLabel('Recording usage receipt', false);
        paperAnimation = paper.animate(
          [{ transform: 'translateY(-101%)' }, { transform: 'translateY(-1%)' }],
          { duration: 1700, easing: 'steps(30, end)', fill: 'forwards' },
        );
      });
      at(3750, () => {
        paperAnimation?.cancel();
        paperAnimation = null;
        paper.style.transform = 'translateY(-1%)';
        setPrintLabel('Receipt complete', true);
      });
    };
    printButton?.addEventListener('click', runPrint);
    cleanup.push(() => printButton?.removeEventListener('click', runPrint));

    if (paper) {
      paper.style.transform = 'translateY(-101%)';
      if (typeof IntersectionObserver === 'function') {
        let printed = false;
        const printObserver = new IntersectionObserver(
          (entries) => {
            if (printed || !entries.some((entry) => entry.isIntersecting)) return;
            printed = true;
            runPrint();
            printObserver.disconnect();
          },
          { threshold: 0.2 },
        );
        printObserver.observe(paper.parentElement ?? paper);
        cleanup.push(() => printObserver.disconnect());
      }
    }

    const copySnippet = async () => {
      if (!copyButton || !code) return;
      const original = copyButton.textContent ?? 'Copy snippet';
      try {
        await navigator.clipboard.writeText(code.innerText);
        copyButton.textContent = 'Code copied';
      } catch {
        copyButton.textContent = 'Select the code to copy';
      }
      const timer = window.setTimeout(() => {
        copyButton.textContent = original;
      }, 1800);
      timers.push(timer);
    };
    copyButton?.addEventListener('click', copySnippet);
    cleanup.push(() => copyButton?.removeEventListener('click', copySnippet));

    const heroCleanup = heroCanvas
      ? buildHeroCanvas(
          heroCanvas,
          heroPointer,
          (render) => {
            heroRender = render;
            render(performance.now());
          },
          (entryY, exitY) => {
            if (!heroHeading) return;
            const [leftGroup, rightGroup] = [...heroHeading.children] as HTMLElement[];
            const leftLine = leftGroup?.children[1] as HTMLElement | undefined;
            const rightLine = rightGroup?.children[0] as HTMLElement | undefined;
            if (!leftGroup || !rightGroup || !leftLine || !rightLine) return;
            const headingTop = heroHeading.getBoundingClientRect().top;
            const leftCenter =
              headingTop + leftGroup.offsetTop + leftLine.offsetTop + leftLine.offsetHeight / 2;
            const rightCenter =
              headingTop + rightGroup.offsetTop + rightLine.offsetTop + rightLine.offsetHeight / 2;
            heroHeading.style.setProperty('--hero-left-shift', `${entryY - leftCenter}px`);
            heroHeading.style.setProperty('--hero-right-shift', `${exitY - rightCenter}px`);
          },
        )
      : () => {};
    const footerCleanup = footerCanvas
      ? buildFooterCanvas(footerCanvas, footerPointer, reducedMotion, (render) => {
          footerRender = render;
          render();
        })
      : () => {};
    cleanup.push(heroCleanup, footerCleanup);

    if (!reducedMotion && typeof IntersectionObserver === 'function') {
      const canvasObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.target === heroCanvas) heroVisible = entry.isIntersecting;
            if (entry.target === footerCanvas) footerVisible = entry.isIntersecting;
          }
          startLoop();
        },
        { rootMargin: '120px 0px', threshold: 0 },
      );
      if (heroCanvas) canvasObserver.observe(heroCanvas);
      if (footerCanvas) canvasObserver.observe(footerCanvas);
      cleanup.push(() => canvasObserver.disconnect());
    } else {
      paint(performance.now(), true);
    }

    return () => {
      window.cancelAnimationFrame(raf);
      paperAnimation?.cancel();
      for (const timer of timers) window.clearTimeout(timer);
      cleanup.reverse().forEach((dispose) => dispose());
    };
  }, []);

  return demoTarget ? createPortal(<InteractiveCreditDemo />, demoTarget) : null;
}

function createRail(
  left: number,
  top: number,
  width: number,
  height: number,
  profile: RailProfile,
) {
  const first = left + width * profile.straightEndX;
  const second = left + width * profile.curveEndX;
  const middle = left + width * profile.controlX;
  const topY = top + height * profile.startY;
  const bottomY = top + height * profile.endY;
  const points: Point[] = [
    { x: left + width * profile.startX, y: topY },
    { x: first, y: topY },
  ];
  for (let index = 1; index <= 96; index += 1) {
    const t = index / 96;
    const inverse = 1 - t;
    points.push({
      x:
        inverse ** 3 * first +
        3 * inverse ** 2 * t * middle +
        3 * inverse * t ** 2 * middle +
        t ** 3 * second,
      y:
        inverse ** 3 * topY +
        3 * inverse ** 2 * t * topY +
        3 * inverse * t ** 2 * bottomY +
        t ** 3 * bottomY,
    });
  }
  points.push({ x: left + width * profile.endX, y: bottomY });
  return points;
}

function railYAtX(points: Point[], x: number) {
  if (x <= points[0].x) return points[0].y;
  if (x >= points.at(-1)!.x) return points.at(-1)!.y;
  let low = 1;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].x < x) low = middle + 1;
    else high = middle;
  }
  const from = points[low - 1];
  const to = points[low];
  const ratio = (x - from.x) / Math.max(0.0001, to.x - from.x);
  return from.y + (to.y - from.y) * ratio;
}

function drawRail(context: CanvasRenderingContext2D, points: Point[], opacity: number) {
  const start = points[0].x;
  const end = points.at(-1)!.x;
  const gradient = context.createLinearGradient(start, 0, end, 0);
  const color = `rgba(242,242,240,${opacity})`;
  gradient.addColorStop(0, 'rgba(242,242,240,0)');
  gradient.addColorStop(0.085, color);
  gradient.addColorStop(0.915, color);
  gradient.addColorStop(1, 'rgba(242,242,240,0)');
  context.strokeStyle = gradient;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.stroke();
}

function wordDots(text: string, width: number, height: number, gap: number, fontFamily: string) {
  const size = 400;
  const font = (pixels: number) => `500 ${pixels}px ${fontFamily}`;
  const probe = document.createElement('canvas');
  const probeContext = probe.getContext('2d');
  if (!probeContext) return [] as Dot[];
  probeContext.font = font(size);
  probeContext.textAlign = 'left';
  probeContext.textBaseline = 'alphabetic';
  const glyphs = [...text].map((character) => {
    const metrics = probeContext.measureText(character);
    const left = metrics.actualBoundingBoxLeft || 0;
    const right = metrics.actualBoundingBoxRight || metrics.width;
    return {
      character,
      left,
      width: Math.max(1, left + right),
      ascent: metrics.actualBoundingBoxAscent || size * 0.72,
      descent: metrics.actualBoundingBoxDescent || 0,
    };
  });
  const tracking = size * 0.105;
  const totalWidth = glyphs.reduce(
    (total, glyph, index) => total + glyph.width + (index ? tracking : 0),
    0,
  );
  const maximumAscent = Math.max(...glyphs.map((glyph) => glyph.ascent));
  const maximumDescent = Math.max(...glyphs.map((glyph) => glyph.descent));
  const inkHeight = maximumAscent + maximumDescent;
  const scale = Math.min((width * 0.93) / totalWidth, (height * 0.82) / inkHeight);
  const drawnWidth = totalWidth * scale;
  const drawnHeight = inkHeight * scale;
  const offsetX = (width - drawnWidth) / 2;
  const offsetY = (height - drawnHeight) / 2;
  const padding = size * 0.08;
  const sourceHeight = Math.ceil(inkHeight + padding * 2);
  const nearby = Math.max(1, Math.round((gap * 0.14) / scale));
  const result: Dot[] = [];
  let pen = 0;

  for (const glyph of glyphs) {
    const sourceWidth = Math.ceil(glyph.width + padding * 2);
    const canvas = document.createElement('canvas');
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const context = canvas.getContext('2d');
    if (!context) continue;
    context.font = font(size);
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillStyle = '#ffffff';
    context.fillText(glyph.character, padding + glyph.left, padding + maximumAscent);
    const image = context.getImageData(0, 0, sourceWidth, sourceHeight).data;
    const alphaAt = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= sourceWidth || y >= sourceHeight) return 0;
      return image[(y * sourceWidth + x) * 4 + 3];
    };
    const cells: Array<{ column: number; row: number; x: number; y: number }> = [];
    const glyphWidth = glyph.width * scale;
    for (let y = gap * 0.5, row = 0; y < drawnHeight; y += gap, row += 1) {
      for (let x = gap * 0.5, column = 0; x < glyphWidth; x += gap, column += 1) {
        const sourceX = Math.round(padding + x / scale);
        const sourceY = Math.round(padding + y / scale);
        const alpha = Math.max(
          alphaAt(sourceX, sourceY),
          alphaAt(sourceX - nearby, sourceY),
          alphaAt(sourceX + nearby, sourceY),
          alphaAt(sourceX, sourceY - nearby),
          alphaAt(sourceX, sourceY + nearby),
        );
        if (alpha > 170) cells.push({ column, row, x, y });
      }
    }
    const occupied = new Set(cells.map((cell) => `${cell.column}:${cell.row}`));
    const cleaned = cells.filter((cell) => {
      for (let y = -1; y <= 1; y += 1) {
        for (let x = -1; x <= 1; x += 1) {
          if ((x || y) && occupied.has(`${cell.column + x}:${cell.row + y}`)) return true;
        }
      }
      return false;
    });
    const topRow = Math.min(...cleaned.map((cell) => cell.row));
    const topCells = cleaned.filter((cell) => cell.row === topRow);
    if (topCells.length) {
      const leftEdge = Math.min(...topCells.map((cell) => cell.x));
      const rightEdge = Math.max(...topCells.map((cell) => cell.x));
      const crownX = offsetX + pen * scale + (leftEdge + rightEdge) / 2;
      result.push({
        x: crownX,
        y: offsetY + topCells[0].y - gap,
        u: (crownX - offsetX) / drawnWidth,
      });
    }
    for (const cell of cleaned) {
      const x = offsetX + pen * scale + cell.x;
      result.push({ x, y: offsetY + cell.y, u: (x - offsetX) / drawnWidth });
    }
    pen += glyph.width + tracking;
  }
  return result;
}

function buildHeroCanvas(
  canvas: HTMLCanvasElement,
  pointer: PointerState,
  ready: (render: (now: number) => boolean) => void,
  alignCopy: (entryY: number, exitY: number) => void,
) {
  const context = canvas.getContext('2d');
  if (!context) return () => {};
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  let width = 0;
  let height = 0;
  let rails: [Point[], Point[]] = [[], []];
  let lineWidth = 4;
  let corridorStart = 0;
  let corridorEnd = 0;
  let restX = 0;
  let restY = 0;
  let lineGlow = 0;
  let node = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: 20,
    scale: 1,
    scaleVelocity: 0,
  };

  const clamp = (value: number, minimum: number, maximum: number) =>
    Math.min(maximum, Math.max(minimum, value));

  const corridorAt = (x: number) => {
    const padding = node.radius + lineWidth * 1.6;
    const minimum = railYAtX(rails[0], x) + padding;
    const maximum = railYAtX(rails[1], x) - padding;
    if (minimum > maximum) {
      const middle = (minimum + maximum) / 2;
      return { minimum: middle, maximum: middle };
    }
    return { minimum, maximum };
  };

  const rebuild = () => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const markWidth = Math.min(width * 0.82, height * 1.5);
    const markHeight = markWidth / 2.48;
    const left = (width - markWidth) / 2;
    const top = (height - markHeight) / 2;
    rails = [
      createRail(left, top, markWidth, markHeight, {
        startX: 0.1,
        straightEndX: 0.35,
        controlX: 0.51,
        curveEndX: 0.65,
        endX: 1,
        startY: 0,
        endY: 0.68,
      }),
      createRail(left, top, markWidth, markHeight, {
        startX: 0,
        straightEndX: 0.28,
        controlX: 0.37,
        curveEndX: 0.58,
        endX: 0.88,
        startY: 0.31,
        endY: 1,
      }),
    ];
    lineWidth = clamp(markWidth * 0.0103, 2.5, 5.5);
    node.radius = clamp(markWidth * 0.048, 15, 25);
    corridorStart = rails[0][0].x + node.radius * 0.55;
    corridorEnd = rails[1].at(-1)!.x - node.radius * 0.55;
    restX = left + markWidth * 0.532;
    const restCorridor = corridorAt(restX);
    restY = clamp(top + markHeight * 0.602, restCorridor.minimum, restCorridor.maximum);
    node.x = restX;
    node.y = restY;
    node.vx = 0;
    node.vy = 0;
    alignCopy(
      rect.top + (rails[0][0].y + rails[1][0].y) / 2,
      rect.top + (rails[0].at(-1)!.y + rails[1].at(-1)!.y) / 2,
    );
  };

  const render = (_now: number) => {
    if (!width || !height) rebuild();
    if (!width || !height || !rails[0].length || !rails[1].length) return false;

    const targetX = pointer.on ? clamp(pointer.x, corridorStart, corridorEnd) : restX;
    const targetCorridor = corridorAt(targetX);
    const targetY = pointer.on
      ? clamp(pointer.y, targetCorridor.minimum, targetCorridor.maximum)
      : restY;
    const targetGlow = pointer.on ? 1 : 0;
    const targetScale = pointer.on ? 1.08 : 1;

    node.vx += (targetX - node.x) * 0.22;
    node.vy += (targetY - node.y) * 0.22;
    node.vx *= 0.68;
    node.vy *= 0.68;
    node.x = clamp(node.x + node.vx, corridorStart, corridorEnd);
    node.y += node.vy;
    const currentCorridor = corridorAt(node.x);
    const constrainedY = clamp(node.y, currentCorridor.minimum, currentCorridor.maximum);
    if (constrainedY !== node.y) node.vy *= 0.2;
    node.y = constrainedY;

    node.scaleVelocity += (targetScale - node.scale) * 0.2;
    node.scaleVelocity *= 0.7;
    node.scale += node.scaleVelocity;
    lineGlow += (targetGlow - lineGlow) * 0.16;

    context.clearRect(0, 0, width, height);

    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = lineWidth + lineGlow * 1.2;
    context.shadowColor = 'rgba(255,255,255,0.95)';
    context.shadowBlur = lineGlow * 24;
    const railOpacity = 0.5 + lineGlow * 0.48;
    drawRail(context, rails[0], railOpacity);
    drawRail(context, rails[1], railOpacity);
    context.restore();

    context.save();
    context.fillStyle = '#ffffff';
    context.shadowColor = 'rgba(255,255,255,0.95)';
    context.shadowBlur = 12 + lineGlow * 18 + Math.max(0, node.scale - 1) * 90;
    context.beginPath();
    context.arc(node.x, node.y, node.radius * node.scale, 0, Math.PI * 2);
    context.fill();
    context.restore();

    return (
      Math.abs(targetX - node.x) > 0.05 ||
      Math.abs(targetY - node.y) > 0.05 ||
      Math.abs(node.vx) > 0.02 ||
      Math.abs(node.vy) > 0.02 ||
      Math.abs(targetGlow - lineGlow) > 0.01 ||
      Math.abs(targetScale - node.scale) > 0.005 ||
      Math.abs(node.scaleVelocity) > 0.002
    );
  };

  rebuild();
  ready(render);
  const observer = new ResizeObserver(() => {
    rebuild();
    render(performance.now());
  });
  observer.observe(canvas.parentElement ?? canvas);
  return () => observer.disconnect();
}

function buildFooterCanvas(
  canvas: HTMLCanvasElement,
  pointer: PointerState,
  reducedMotion: boolean,
  ready: (render: () => boolean) => void,
) {
  const context = canvas.getContext('2d');
  if (!context) return () => {};
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  let width = 0;
  let height = 0;
  let gap = 10;
  let particles: Particle[] = [];

  const rebuild = () => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    gap = Math.max(7, Math.min(13, width / 105));
    const fontFamily = getComputedStyle(canvas).fontFamily;
    particles = wordDots('Resvary', width, height, gap, fontFamily).map((dot) => ({
      bx: dot.x,
      by: dot.y,
      x: dot.x,
      y: dot.y,
      vx: 0,
      vy: 0,
    }));
  };

  const render = () => {
    if (!width || !height || !particles.length) rebuild();
    if (!width || !height) return false;
    const radius = 120;
    const baseRadius = gap * 0.42;
    let active = pointer.on;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#ffffff';
    context.shadowColor = 'rgba(255,255,255,0.95)';
    for (const particle of particles) {
      let lit = 0;
      if (pointer.on) {
        const dx = particle.x - pointer.x;
        const dy = particle.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < radius) {
          lit = (1 - distance / radius) ** 2;
          const inverse = distance || 0.001;
          particle.vx += (dx / inverse) * lit * 3.6;
          particle.vy += (dy / inverse) * lit * 3.6;
        }
      }
      particle.vx += (particle.bx - particle.x) * 0.055;
      particle.vy += (particle.by - particle.y) * 0.055;
      particle.vx *= 0.87;
      particle.vy *= 0.87;
      particle.x += particle.vx;
      particle.y += particle.vy;
      if (
        Math.abs(particle.vx) > 0.025 ||
        Math.abs(particle.vy) > 0.025 ||
        Math.abs(particle.x - particle.bx) > 0.025 ||
        Math.abs(particle.y - particle.by) > 0.025
      ) {
        active = true;
      }
      const displacement = Math.min(
        1,
        Math.hypot(particle.x - particle.bx, particle.y - particle.by) / 24,
      );
      const glow = Math.max(lit, displacement);
      context.globalAlpha = 0.58 + 0.42 * glow;
      context.shadowBlur = glow > 0.1 ? 13 * glow : 0;
      context.beginPath();
      context.arc(particle.x, particle.y, baseRadius + glow * 1.1, 0, Math.PI * 2);
      context.fill();
    }
    context.shadowBlur = 0;
    context.globalAlpha = 1;
    return active;
  };

  rebuild();
  ready(render);
  let active = true;
  document.fonts?.ready
    .then(() => {
      if (!active) return;
      rebuild();
      if (reducedMotion) render();
    })
    .catch(() => {});
  const observer = new ResizeObserver(() => {
    rebuild();
    if (reducedMotion) render();
  });
  observer.observe(canvas);
  return () => {
    active = false;
    observer.disconnect();
  };
}
