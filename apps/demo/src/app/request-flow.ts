import styles from './request-flow.module.css';

export const REQUEST_FLOW_HTML = `<figure class="${styles.figure}" data-request-flow="true" data-reactive-diagram="true">
  <div class="${styles.diagram}">
    <svg viewBox="0 0 540 300" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="request-flow-input" x1="18" y1="150" x2="236" y2="150" gradientUnits="userSpaceOnUse">
          <stop stop-color="currentColor" stop-opacity="0.18" />
          <stop offset="1" stop-color="currentColor" stop-opacity="0.82" />
        </linearGradient>
      </defs>
      <g class="${styles.orbits}">
        <circle cx="236" cy="150" r="72" />
        <circle cx="236" cy="150" r="40" />
      </g>
      <g class="${styles.inputs}" data-diagram-anchor="requests">
        <path id="request-flow-input-path" d="M18 96H126L236 150M18 108H130L236 150M18 120H134L236 150M18 132H138L236 150M18 144H142L236 150M18 156H142L236 150M18 168H138L236 150M18 180H134L236 150M18 192H130L236 150M18 204H126L236 150" />
      </g>
      <use class="${styles.inputHighlight}" href="#request-flow-input-path" />
      <g class="${styles.routes}">
        <path class="${styles.trunk}" d="M236 150H338" />
        <path class="${styles.commitRoute}" d="M338 150 435 60H518M513 56l5 4-5 4" />
        <path class="${styles.releaseRoute}" d="M338 150H518M513 146l5 4-5 4" />
        <path class="${styles.receiptRoute}" d="M338 150 435 240H518M513 236l5 4-5 4" />
      </g>
      <g class="${styles.outputOrbits}">
        <circle class="${styles.commitOrbit}" data-diagram-anchor="commit" cx="435" cy="60" r="31" />
        <circle class="${styles.releaseOrbit}" data-diagram-anchor="release" cx="435" cy="150" r="31" />
        <circle class="${styles.receiptOrbit}" data-diagram-anchor="receipt" cx="435" cy="240" r="31" />
      </g>
      <circle class="${styles.holdNode}" data-diagram-anchor="reserve" cx="292" cy="150" r="23" />
      <g class="${styles.points}">
        <circle cx="236" cy="150" r="3" />
        <circle cx="338" cy="150" r="3" />
        <circle cx="435" cy="60" r="3" />
        <circle cx="435" cy="150" r="3" />
        <circle cx="435" cy="240" r="3" />
        <rect x="285" y="139" width="5" height="22" />
        <rect x="294" y="139" width="5" height="22" />
      </g>
    </svg>
    <span class="${styles.label} ${styles.requests}" data-diagram-hotspot="requests" aria-hidden="true">AI requests</span>
    <span class="${styles.label} ${styles.reserve}" data-diagram-hotspot="reserve" aria-hidden="true">Reserve</span>
    <span class="${styles.label} ${styles.commit}" data-diagram-hotspot="commit" aria-hidden="true">Commit</span>
    <span class="${styles.label} ${styles.release}" data-diagram-hotspot="release" aria-hidden="true">Release</span>
    <span class="${styles.label} ${styles.receipt}" data-diagram-hotspot="receipt" aria-hidden="true">Receipt</span>
  </div>
  <figcaption class="${styles.caption}">AI requests enter a credit reservation before provider work. After execution, Resvary commits actual usage, releases unused credits, and records a receipt.</figcaption>
</figure>`;
