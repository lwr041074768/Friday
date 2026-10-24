import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import './startup-intro.css';

type StartupIntroProps = {
  onComplete: () => void;
  durationMs?: number;
};

const CURVE_PATH = 'M 98 277 C 157 277, 192 273, 232 264 C 274 256, 304 244, 337 229 C 378 210, 405 187, 435 162 C 469 133, 493 111, 529 96 C 567 79, 608 76, 655 76';
const DATA_POINTS = [
  [98, 277], [168, 275], [232, 264], [290, 249],
  [337, 229], [390, 202], [435, 162], [482, 121],
  [529, 96], [591, 79], [655, 76],
] as const;

/** A visual introduction only: workspaces continue mounting behind it. */
export default function StartupIntro({ onComplete, durationMs = 6000 }: StartupIntroProps) {
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const skipButton = useRef<HTMLButtonElement>(null);
  const completed = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const id = useId().replace(/:/g, '');
  const animationDuration = Number.isFinite(durationMs) ? Math.min(10000, Math.max(5000, durationMs)) : 6000;
  const complete = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    onCompleteRef.current();
  }, []);

  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(complete, reducedMotion ? 180 : animationDuration);
    return () => window.clearTimeout(timer);
  }, [animationDuration, complete, reducedMotion]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    skipButton.current?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      complete();
    };
    window.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('keydown', escape, true);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [complete]);

  return <div
    className="startup-intro"
    role="dialog"
    aria-modal="true"
    aria-labelledby={`${id}-title`}
    data-testid="startup-intro"
    data-reduced-motion={String(reducedMotion)}
    style={{ '--intro-duration': `${animationDuration}ms` } as CSSProperties}
  >
    <div className="startup-intro__ambient startup-intro__ambient--blue" aria-hidden="true"/>
    <div className="startup-intro__ambient startup-intro__ambient--teal" aria-hidden="true"/>
    <div className="startup-intro__texture" aria-hidden="true"/>
    <button ref={skipButton} className="startup-intro__skip" type="button" onClick={complete} aria-label="跳过启动动画">
      跳过动画 <kbd>Esc</kbd>
    </button>
    <div className="startup-intro__content">
      <svg className="startup-intro__figure" viewBox="0 0 760 370" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-curve`} x1="98" y1="277" x2="655" y2="76" gradientUnits="userSpaceOnUse">
            <stop stopColor="#669bff"/>
            <stop offset=".48" stopColor="#73bcff"/>
            <stop offset="1" stopColor="#64e0d6"/>
          </linearGradient>
          <linearGradient id={`${id}-area`} x1="380" y1="76" x2="380" y2="295" gradientUnits="userSpaceOnUse">
            <stop stopColor="#5bacf4" stopOpacity=".16"/>
            <stop offset="1" stopColor="#5bacf4" stopOpacity="0"/>
          </linearGradient>
        </defs>
        <g className="startup-intro__grid">
          {[100, 170, 240, 310, 380, 450, 520, 590, 660].map(x => <path key={`x${x}`} d={`M ${x} 46 V 295`}/>)}
          {[55, 115, 175, 235, 295].map(y => <path key={`y${y}`} d={`M 70 ${y} H 690`}/>)}
        </g>
        <path className="startup-intro__axes" d="M 70 46 V 295 H 690"/>
        <path className="startup-intro__frame" d="M 70 58 V 46 H 82 M 678 46 H 690 V 58 M 690 283 V 295 H 678 M 82 295 H 70 V 283"/>
        <path className="startup-intro__area" d={`${CURVE_PATH} L 655 295 H 98 Z`} fill={`url(#${id}-area)`}/>
        <path className="startup-intro__curve-glow" d={CURVE_PATH} stroke={`url(#${id}-curve)`} pathLength="1"/>
        <path className="startup-intro__curve" d={CURVE_PATH} stroke={`url(#${id}-curve)`} pathLength="1"/>
        <g className="startup-intro__points">
          {DATA_POINTS.map(([x, y], index) => <g key={x} className="startup-intro__point" style={{ '--point-order': index } as CSSProperties}>
            <circle className="startup-intro__point-halo" cx={x} cy={y} r="8"/>
            <circle cx={x} cy={y} r="3.25"/>
          </g>)}
        </g>
        <g className="startup-intro__guides">
          <path d="M 435 162 V 295 M 70 162 H 435"/>
          <circle cx="435" cy="162" r="12"/>
          <path d="M 435 143 V 149 M 435 175 V 181 M 416 162 H 422 M 448 162 H 454"/>
        </g>
      </svg>
      <div className="startup-intro__brand">
        <svg className="startup-intro__mark" width="58" height="58" viewBox="0 0 58 58" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="56" height="56" rx="17"/>
          <path d="M 12 30 H 19 L 23 17 L 29 40 L 34 25 L 38 30 H 46"/>
        </svg>
        <div className="startup-intro__wordmark"><h1 id={`${id}-title`}>Friday</h1><p>ELECTROCATALYSIS STUDIO</p></div>
      </div>
      <p className="startup-intro__subtitle">把实验数据，变成清晰的图。</p>
    </div>
    <div className="startup-intro__signature" aria-hidden="true"><span/><i>DATA</i><span/><i>INSIGHT</i><span/></div>
  </div>;
}
