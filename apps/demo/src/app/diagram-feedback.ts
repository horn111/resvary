type Anchor = { element: Element; name: string };
type AnchorPosition = { name: string; x: number; y: number };

export function attachDiagramFeedback(root: HTMLElement) {
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const cleanup: Array<() => void> = [];

  for (const diagram of root.querySelectorAll<HTMLElement>('[data-reactive-diagram]')) {
    const anchors: Anchor[] = [...diagram.querySelectorAll('[data-diagram-anchor]')].map(
      (element) => ({ element, name: element.getAttribute('data-diagram-anchor') ?? '' }),
    );
    let positions: AnchorPosition[] | null = null;
    let radius = 120;
    let active = '';

    const setActive = (name: string) => {
      if (name === active) return;
      active = name;
      if (name) diagram.setAttribute('data-diagram-active', name);
      else diagram.removeAttribute('data-diagram-active');
    };
    const clear = () => {
      setActive('');
      positions = null;
    };
    const measure = () => {
      positions = anchors.map(({ element, name }) => {
        const bounds = element.getBoundingClientRect();
        return { name, x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
      });
      radius = Math.min(150, Math.max(90, diagram.getBoundingClientRect().width * 0.24));
    };
    const move = (event: PointerEvent) => {
      if (!finePointer.matches || event.pointerType === 'touch') {
        clear();
        return;
      }
      const hotspot =
        event.target instanceof Element ? event.target.closest('[data-diagram-hotspot]') : null;
      if (hotspot && diagram.contains(hotspot)) {
        setActive(hotspot.getAttribute('data-diagram-hotspot') ?? '');
        return;
      }
      if (!positions) measure();
      let nearest = '';
      let distance = radius ** 2;
      for (const point of positions ?? []) {
        const candidate = (point.x - event.clientX) ** 2 + (point.y - event.clientY) ** 2;
        if (candidate < distance) {
          distance = candidate;
          nearest = point.name;
        }
      }
      setActive(nearest);
    };

    diagram.addEventListener('pointermove', move, { passive: true });
    diagram.addEventListener('pointerleave', clear);
    diagram.addEventListener('pointercancel', clear);
    window.addEventListener('scroll', clear, { passive: true });
    window.addEventListener('resize', clear);
    finePointer.addEventListener('change', clear);
    cleanup.push(() => {
      diagram.removeEventListener('pointermove', move);
      diagram.removeEventListener('pointerleave', clear);
      diagram.removeEventListener('pointercancel', clear);
      window.removeEventListener('scroll', clear);
      window.removeEventListener('resize', clear);
      finePointer.removeEventListener('change', clear);
      clear();
    });
  }

  return () => cleanup.forEach((dispose) => dispose());
}
