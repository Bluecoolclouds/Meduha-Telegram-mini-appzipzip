import './_group.css';
import { ArrowRight, Music2 } from 'lucide-react';

export function Refresh() {
  return (
    <main className="home-music-frame">
      <a className="music-feature-card press" href="/create?type=music">
        <span className="music-feature-icon" aria-hidden="true"><Music2 /></span>
        <span className="music-feature-copy">
          <span className="music-feature-kicker">Своя музыка</span>
          <strong>А может, свой трек?</strong>
          <small>Из пары слов</small>
        </span>
        <span className="music-feature-arrow" aria-hidden="true"><ArrowRight /></span>
      </a>
    </main>
  );
}
