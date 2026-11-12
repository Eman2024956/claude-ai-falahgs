// Builds the page's text from plan.content. Text is always inserted with
// textContent, and links are limited by the schema to in-page anchors and
// mailto, so a plan cannot inject markup or scripts.

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const FADE = 0.035; // share of the scroll over which a section fades in or out

export function buildContent(plan, root, scrollToProgress) {
  const { brand, sections } = plan.content;
  const theme = plan.theme;
  const style = document.documentElement.style;
  style.setProperty('--bg', theme.background);
  style.setProperty('--text', theme.text);
  style.setProperty('--muted', theme.muted);
  style.setProperty('--accent', theme.accent);
  document.title = plan.meta.title;

  const goTo = (section) => scrollToProgress(section.range[0] === 0 ? 0 : (section.range[0] + section.range[1]) / 2);
  const byId = Object.fromEntries(sections.map((s) => [s.id, s]));

  // Header
  const header = el('header', 'site-header');
  const home = el('a', 'brand', brand);
  home.href = `#${sections[0].id}`;
  home.addEventListener('click', (e) => { e.preventDefault(); goTo(sections[0]); });
  const nav = el('nav', 'site-nav');
  nav.setAttribute('aria-label', 'Sections');
  const navLinks = [];
  for (const section of sections) {
    if (!section.nav) continue;
    const a = el('a', 'site-nav__link', section.nav);
    a.href = `#${section.id}`;
    a.addEventListener('click', (e) => { e.preventDefault(); goTo(section); });
    nav.append(a);
    navLinks.push({ a, section });
  }
  header.append(home, nav);

  // Sections
  const main = el('main', 'sections');
  const panels = sections.map((section, index) => {
    const panel = el('section', `panel panel--${section.kind} panel--${section.align || 'left'}`);
    panel.id = section.id;
    const inner = el('div', 'panel__inner');
    if (section.eyebrow) inner.append(el('p', 'panel__eyebrow', section.eyebrow));
    inner.append(el(index === 0 ? 'h1' : 'h2', 'panel__heading', section.heading));
    if (section.body) inner.append(el('p', 'panel__body', section.body));
    if (section.stats?.length) {
      const list = el('dl', 'stats');
      for (const stat of section.stats) {
        const item = el('div', 'stat');
        const value = el('dd', 'stat__value', stat.value);
        if (stat.unit) value.append(el('span', 'stat__unit', stat.unit));
        item.append(el('dt', 'stat__label', stat.label), value);
        list.append(item);
      }
      inner.append(list);
    }
    if (section.actions?.length) {
      const row = el('div', 'actions');
      section.actions.forEach((action, i) => {
        const a = el('a', i === 0 ? 'btn btn--primary' : 'btn', action.label);
        a.href = action.href;
        const target = action.href.startsWith('#') && byId[action.href.slice(1)];
        if (target) a.addEventListener('click', (e) => { e.preventDefault(); goTo(target); });
        row.append(a);
      });
      inner.append(row);
    }
    panel.append(inner);
    // Keyboard users reach a hidden section's links: bring it into view.
    panel.addEventListener('focusin', () => {
      if (!panel.classList.contains('is-active')) goTo(section);
    });
    main.append(panel);
    return { panel, section };
  });

  const hint = el('div', 'scroll-hint');
  hint.setAttribute('aria-hidden', 'true');
  hint.append(el('span', 'scroll-hint__label', 'Scroll'), el('span', 'scroll-hint__line'));
  const progressBar = el('div', 'progress');
  progressBar.setAttribute('aria-hidden', 'true');
  const fill = el('i');
  progressBar.append(fill);

  root.append(header, main, hint, progressBar);

  const last = sections.length - 1;
  return {
    update(p) {
      panels.forEach(({ panel, section }, i) => {
        const [from, to] = section.range;
        const fadeIn = i === 0 ? 1 : Math.min(Math.max((p - from) / FADE, 0), 1);
        const fadeOut = i === last ? 1 : Math.min(Math.max((to - p) / FADE, 0), 1);
        const v = Math.min(fadeIn, fadeOut);
        panel.style.setProperty('--v', v.toFixed(3));
        panel.style.setProperty('--shift', (fadeIn < 1 ? 1 - fadeIn : fadeOut - 1).toFixed(3));
        panel.classList.toggle('is-active', v > 0.5);
      });
      for (const { a, section } of navLinks) {
        const current = p >= section.range[0] - FADE && p <= section.range[1] + FADE;
        if (current) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      }
      hint.style.opacity = String(Math.max(1 - p * 30, 0));
      fill.style.transform = `scaleX(${p.toFixed(4)})`;
    },
  };
}
