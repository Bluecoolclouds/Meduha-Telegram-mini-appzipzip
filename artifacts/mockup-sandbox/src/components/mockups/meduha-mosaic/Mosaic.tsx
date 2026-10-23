import { useMemo, useState } from 'react';
import {
  ArrowRight, Camera, ChevronRight, Film, Flower2, House, Images, Plus, Search,
  Sparkles, UserRound, UsersRound, X,
} from 'lucide-react';
import './_group.css';

type Artwork = { title: string; image: string; category: string; prompt: string; size: string; tag: string };

const artwork: Artwork[] = [
  { title: 'Тихая орбита', image: 'meduha/astronaut.png', category: 'Видео', prompt: 'Кинематографичный портрет астронавта на фоне мягкого космического свечения, тонкое зерно плёнки и ощущение тишины.', size: 'mm-art-one', tag: 'Космос' },
  { title: 'Сад после дождя', image: 'meduha/flower.png', category: 'Изображения', prompt: 'Макро-цветок с каплями воды, живые лепестки и нежный рассеянный свет раннего утра.', size: 'mm-art-two', tag: 'Природа' },
  { title: 'Город в движении', image: 'meduha-deep/neon-rain.png', category: 'Видео', prompt: 'Ночной город после дождя, отражения на асфальте, красные огни и плавный кинематографичный проезд камеры.', size: 'mm-art-three', tag: 'Атмосфера' },
  { title: 'Мягкий фокус', image: 'meduha/portrait.png', category: 'Портреты', prompt: 'Редакционный портрет с мягкой вспышкой, выразительными тенями и фактурой аналоговой фотографии.', size: 'mm-art-four', tag: 'Портрет' },
  { title: 'Шёлковая линия', image: 'meduha-deep/dune-silk.png', category: 'Изображения', prompt: 'Текучие золотистые дюны словно шёлковая ткань, лаконичная композиция и тёплый вечерний свет.', size: 'mm-art-five', tag: 'Фактура' },
  { title: 'Ветер у воды', image: 'meduha/wave.png', category: 'Изображения', prompt: 'Волна, снятая в момент движения, глубокий бирюзовый тон и ощущение воздуха в кадре.', size: 'mm-art-six', tag: 'Вода' },
  { title: 'Балет в полумраке', image: 'meduha-deep/ballet.png', category: 'Видео', prompt: 'Силуэт танцовщицы в театральном свете, пыль в лучах и выразительный смаз движения.', size: 'mm-art-two', tag: 'Движение' },
  { title: 'На высоте', image: 'meduha-deep/sky-islands.png', category: 'Изображения', prompt: 'Парящие острова в облаках, светлая сказочная перспектива и спокойная пастельная палитра.', size: 'mm-art-three', tag: 'Фантазия' },
  { title: 'Городской силуэт', image: 'meduha/city.png', category: 'Портреты', prompt: 'Стильный городской портрет на фоне современной архитектуры, естественная поза и мягкий контраст.', size: 'mm-art-four', tag: 'Город' },
];

const categories = [
  { label: 'Изображения', image: 'meduha/fashion.png', icon: Camera },
  { label: 'Видео', image: 'meduha-deep/ballet.png', icon: Film },
  { label: 'Портреты', image: 'meduha/portrait.png', icon: UserRound },
  { label: 'Идеи', image: 'meduha-deep/sky-islands.png', icon: Flower2 },
];

const slides = [
  { title: <>Идея, которой<br />не было вчера</>, subtitle: 'Поиграйте с образами — найдите свой.', image: 'meduha-deep/sky-islands.png', eyebrow: 'Место для вдохновения' },
  { title: <>Кадр из вашего<br />воображения</>, subtitle: 'Соберите настроение из пары слов.', image: 'meduha-deep/dune-silk.png', eyebrow: 'Студия образов' },
  { title: <>Пусть будет<br />немного магии</>, subtitle: 'Создавайте в своём ритме.', image: 'meduha-deep/abyss.png', eyebrow: 'Привет, творец' },
];

export function Mosaic() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [slide, setSlide] = useState(0);
  const [selected, setSelected] = useState<Artwork | null>(null);
  const [activeNav, setActiveNav] = useState('Главная');
  const visibleItems = useMemo(() => artwork.filter((item) =>
    (!category || item.category === category || (category === 'Идеи' && item.category === 'Видео')) &&
    (!query || `${item.title} ${item.category} ${item.tag} ${item.prompt}`.toLowerCase().includes(query.toLowerCase())),
  ), [query, category]);
  const left = visibleItems.filter((_, index) => index % 2 === 0);
  const right = visibleItems.filter((_, index) => index % 2 === 1);
  const currentSlide = slides[slide];

  return (
    <div className="meduha-mosaic">
      <main className="mm-screen">
        <div className="mm-scroll">
          <header className="mm-topline">
            <div className="mm-brand">
              <img src="/__mockup/images/brand/app-icon.png" alt="" />
              <span className="mm-wordmark">meduha<i>.</i></span>
            </div>
            <div className="mm-header-right">
              <span className="mm-hello">Твоя творческая студия</span>
              <img className="mm-welcome" src="/__mockup/images/brand/mascot-hello.png" alt="Медуза приветствует" />
            </div>
          </header>

          <label className="mm-search">
            <Search size={17} />
            <input aria-label="Поиск по идеям" placeholder="Найти вдохновение" value={query} onChange={(event) => setQuery(event.target.value)} />
            {query && <button className="mm-header-action" style={{ width: 25, height: 25, border: 0 }} aria-label="Очистить поиск" onClick={() => setQuery('')}><X size={14} /></button>}
          </label>

          <section className="mm-hero" aria-label="Подборка вдохновения">
            <img src={`/__mockup/images/${currentSlide.image}`} alt="" />
            <div className="mm-hero-copy">
              <span className="mm-kicker"><Sparkles size={10} /> {currentSlide.eyebrow}</span>
              <h1>{currentSlide.title}</h1>
              <p>{currentSlide.subtitle}</p>
              <button className="mm-hero-link" onClick={() => { setCategory(''); document.getElementById('mm-gallery')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
                Смотреть идеи <ArrowRight size={13} />
              </button>
            </div>
            <div className="mm-hero-dots" aria-label="Слайды">
              {slides.map((item, index) => <button key={item.eyebrow} className={`mm-dot${index === slide ? ' active' : ''}`} aria-label={`Слайд ${index + 1}`} aria-pressed={index === slide} onClick={() => setSlide(index)} />)}
            </div>
          </section>

          <section aria-labelledby="mm-create-title">
            <div className="mm-section-head">
              <div><h2 id="mm-create-title">С чего начнём?</h2><p>Выбери направление и ныряй в идею</p></div>
              <img src="/__mockup/images/brand/mascot-wink.png" alt="" style={{ width: 34, height: 34, objectFit: 'contain' }} />
            </div>
            <div className="mm-category-row">
              {categories.map(({ label, image, icon: Icon }) => (
                <button key={label} className={`mm-category${category === label ? ' selected' : ''}`} aria-pressed={category === label} onClick={() => setCategory(category === label ? '' : label)}>
                  <img src={`/__mockup/images/${image}`} alt="" />
                  <span className="mm-cat-mark"><Icon size={13} /></span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </section>

          <section id="mm-gallery" aria-labelledby="mm-gallery-title">
            <div className="mm-section-head mm-feed-heading">
              <div><h2 id="mm-gallery-title">{category || 'Лента вдохновения'}</h2><p>{query ? 'Результаты локального поиска' : 'Образы, которые хочется сохранить'}</p></div>
              {(category || query) && <button className="mm-text-button" onClick={() => { setCategory(''); setQuery(''); }}>Сбросить <X size={12} /></button>}
              {!category && !query && <button className="mm-text-button" onClick={() => setActiveNav('Комьюнити')}>Вся лента <ChevronRight size={13} /></button>}
            </div>
            <div className="mm-mosaic">
              {visibleItems.length ? [left, right].map((column, columnIndex) => (
                <div className="mm-column" key={columnIndex}>
                  {column.map((item) => (
                    <button key={item.title} className={`mm-art ${item.size}`} onClick={() => setSelected(item)} aria-label={`Открыть работу: ${item.title}`}>
                      <img src={`/__mockup/images/${item.image}`} alt={item.title} loading="lazy" />
                      <span className="mm-art-tag">{item.tag}</span>
                      <span className="mm-art-name">{item.title}</span>
                    </button>
                  ))}
                </div>
              )) : (
                <div className="mm-empty">
                  <img src="/__mockup/images/brand/mascot-thinking.png" alt="" />
                  <strong>Пока ничего не нашлось</strong><span>Попробуй другое слово или направление.</span>
                </div>
              )}
            </div>
            <div className="mm-demo-note"><img src="/__mockup/images/brand/mascot-glossy.png" alt="" /> Дизайн-концепт · демо-медиа</div>
          </section>
        </div>

        <div className="mm-nav-wrap">
          <nav className="mm-nav" aria-label="Основная навигация">
            {[{ label: 'Главная', icon: House }, { label: 'Комьюнити', icon: UsersRound }, { label: 'Создать', icon: PlusIcon }, { label: 'Мои работы', icon: Images }, { label: 'Профиль', icon: UserRound }].map(({ label, icon: Icon }) => (
              <button key={label} className={`${activeNav === label ? 'active ' : ''}${label === 'Создать' ? 'mm-create' : ''}`} aria-label={label} onClick={() => setActiveNav(label)}>
                <Icon size={label === 'Создать' ? 21 : 19} strokeWidth={label === 'Создать' ? 2.5 : 1.9} /><span>{label}</span>
              </button>
            ))}
          </nav>
        </div>

        {selected && (
          <div className="mm-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
            <section className="mm-detail" role="dialog" aria-modal="true" aria-label={`Предпросмотр: ${selected.title}`}>
              <button className="mm-detail-close" aria-label="Закрыть предпросмотр" onClick={() => setSelected(null)}><X size={18} /></button>
              <img className="mm-detail-image" src={`/__mockup/images/${selected.image}`} alt={selected.title} />
              <div className="mm-detail-copy">
                <span className="mm-detail-eyebrow">{selected.category} · демо-медиа</span>
                <h3>{selected.title}</h3>
                <div className="mm-prompt">{selected.prompt}</div>
                <div className="mm-detail-foot"><span>Пример настроения и промпта</span><img src="/__mockup/images/brand/mascot-hello.png" alt="" /></div>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function PlusIcon({ size, strokeWidth }: { size?: number; strokeWidth?: number }) {
  return <Plus size={size} strokeWidth={strokeWidth} />;
}
