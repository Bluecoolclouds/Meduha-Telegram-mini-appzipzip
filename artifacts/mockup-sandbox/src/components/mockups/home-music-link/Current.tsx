import './_group.css';
import { ArrowRight, Music2 } from 'lucide-react';

export function Current() {
  return (
    <main className="home-music-frame">
      <a className="m-music-link press" href="/create?type=music">
        <span className="music-icon"><Music2 size={17} /></span>
        <strong>А может, свой трек?</strong>
        <small>Из пары слов</small>
        <ArrowRight size={15} />
      </a>
    </main>
  );
}
