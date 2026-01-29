const state = {
  index: null,
  bookId: null,
  chapter: 1,
  colA: 'NKRV',
  colB: 'KNT',
  showLiteral: true,
  literalIndex: null,
};

const CSV_BOOK_OVERRIDES = {
  'Song of Solomon': 'Song_of_songs',
};

const CSV_LABELS = {
  Book: '책',
  Chapter: '장',
  Verse: '절',
  'Clause Type': '절 유형',
  'Mother Clause Type': '상위 절 유형',
  'Predicted TAM': '시제/태',
  'Hebrew Text': '히브리어',
  'Word Order': '어순',
  'Korean Literal': '직역',
};

const WORD_ORDER_MAP = {
  Adju: '부가어',
  Cmpl: '보어',
  Conj: '접속',
  EPPr: '전치구(EPPr)',
  ExsS: '존재문 주어',
  Exst: '존재',
  Frnt: '전면화',
  IntS: '의문 주어',
  Intj: '감탄',
  Loca: '장소',
  ModS: '주어 수식',
  Modi: '수식어',
  NCoS: '명사계사 주어',
  NCop: '명사계사',
  Nega: '부정',
  Objc: '목적어',
  PrAd: '술부 부가어',
  PrcS: '술부 보어 주어',
  PreC: '전치 보어',
  PreO: '전치 목적어',
  PreS: '전치 주어',
  Pred: '서술',
  PtcO: '분사 목적어',
  Ques: '의문',
  Rela: '관계',
  Subj: '주어',
  Supp: '보충',
  Time: '시간',
  Voct: '호격',
};

const els = {
  bookSelect: document.getElementById('bookSelect'),
  chapterSelect: document.getElementById('chapterSelect'),
  colASelect: document.getElementById('colASelect'),
  colBSelect: document.getElementById('colBSelect'),
  toggleLiteral: document.getElementById('toggleLiteral'),
  prevChapter: document.getElementById('prevChapter'),
  nextChapter: document.getElementById('nextChapter'),
  verseList: document.getElementById('verseList'),
  columnHeaders: document.getElementById('columnHeaders'),
  colALabel: document.getElementById('colALabel'),
  colBLabel: document.getElementById('colBLabel'),
  colLiteralLabel: document.getElementById('colLiteralLabel'),
  clauseTooltip: document.getElementById('clauseTooltip'),
};

const tooltipState = {
  pinned: false,
  key: null,
};

function setLoading(message = '로딩 중...') {
  els.verseList.innerHTML = `<div class="empty-state">${message}</div>`;
}

async function loadIndex() {
  const res = await fetch('./data/index.json');
  state.index = await res.json();
}

function setOptions(selectEl, options, selectedValue) {
  selectEl.innerHTML = '';
  options.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if (value === selectedValue) option.selected = true;
    selectEl.appendChild(option);
  });
}

function initSelectors() {
  const bookOptions = state.index.books.map((book) => ({
    value: book.id,
    label: `${book.name_ko || ''} ${book.name_en}`.trim(),
  }));
  state.bookId = bookOptions[0]?.value || null;
  setOptions(els.bookSelect, bookOptions, state.bookId);

  const translationOptions = Object.entries(state.index.translations).map(([key, meta]) => ({
    value: key,
    label: meta.label,
  }));
  setOptions(els.colASelect, translationOptions, state.colA);
  setOptions(els.colBSelect, translationOptions, state.colB);
  updateChapterOptions();
}

function updateChapterOptions() {
  if (!state.bookId) return;
  const translations = state.index.translations;
  const chapters = [state.colA, state.colB]
    .map((t) => translations[t]?.chapterFiles[state.bookId]?.length || 0);
  const maxChapter = Math.max(...chapters, 1);
  const chapterOptions = Array.from({ length: maxChapter }, (_, i) => ({
    value: String(i + 1),
    label: `${i + 1}장`,
  }));
  if (state.chapter > maxChapter) state.chapter = maxChapter;
  setOptions(els.chapterSelect, chapterOptions, String(state.chapter));
}

function chapterPath(translationId, bookId, chapter) {
  const translation = state.index.translations[translationId];
  const bookDir = translation.bookDirs[bookId];
  const files = translation.chapterFiles[bookId];
  if (!bookDir || !files || !files[chapter - 1]) return null;
  return `${translation.dir}/${bookDir}/${files[chapter - 1]}`;
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function parseVerses(text, translationId) {
  const verses = new Map();
  const lines = text.split(/\r?\n/);
  let inFrontMatter = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === '---') {
      inFrontMatter = !inFrontMatter;
      continue;
    }
    if (inFrontMatter) continue;
    if (line.startsWith('#') || line.startsWith('>')) continue;
    let match = null;
    if (translationId === 'KNT') {
      match = line.match(/^[-*]\s*(\d+):\s*(.+)$/);
    }
    if (!match) {
      match = line.match(/^(\d+)\.\s*(.+)$/);
    }
    if (!match) {
      match = line.match(/^(\d+)\s+(.+)$/);
    }
    if (match) {
      const verse = Number(match[1]);
      const textValue = match[2].trim();
      if (!Number.isNaN(verse)) {
        verses.set(verse, textValue);
      }
    }
  }
  return verses;
}

async function loadTranslation(translationId, bookId, chapter) {
  const path = chapterPath(translationId, bookId, chapter);
  if (!path) return new Map();
  const res = await fetch(encodePath(path));
  if (!res.ok) return new Map();
  const text = await res.text();
  return parseVerses(text, translationId);
}

async function loadLiteralIndex() {
  if (state.literalIndex) return state.literalIndex;
  const csvUrl = new URL('성경 직역 정보.csv', window.location.href);
  const res = await fetch(csvUrl);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const literalIndex = {};
  const headerLine = lines.find((line) => line.startsWith('Book;')) || '';
  const header = headerLine.split(';').map((value) => value.trim());
  const headerIndex = Object.fromEntries(header.map((key, idx) => [key, idx]));
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/^\uFEFF/, '');
    if (line.startsWith('Book;')) continue;
    const row = line.split(';');
    if (row.length < 3) continue;
    const book = row[headerIndex.Book]?.trim();
    const chapter = Number(row[headerIndex.Chapter]);
    const verse = Number(row[headerIndex.Verse]);
    const koreanLiteral = row[headerIndex['Korean Literal']]?.trim();
    if (!book || Number.isNaN(chapter) || Number.isNaN(verse) || !koreanLiteral) continue;
    const clause = {
      book,
      chapter,
      verse,
      location: `${book.replace(/_/g, ' ')} ${chapter}:${verse}`,
      clauseType: row[headerIndex['Clause Type']]?.trim() || '',
      motherClauseType: row[headerIndex['Mother Clause Type']]?.trim() || '',
      predictedTAM: row[headerIndex['Predicted TAM']]?.trim() || '',
      hebrewText: row[headerIndex['Hebrew Text']]?.trim() || '',
      wordOrder: row[headerIndex['Word Order']]?.trim() || '',
      wordOrderKo: translateWordOrder(row[headerIndex['Word Order']]?.trim() || ''),
      koreanLiteral,
    };
    if (!literalIndex[book]) literalIndex[book] = {};
    if (!literalIndex[book][chapter]) literalIndex[book][chapter] = {};
    if (!literalIndex[book][chapter][verse]) literalIndex[book][chapter][verse] = [];
    literalIndex[book][chapter][verse].push(clause);
  }
  state.literalIndex = literalIndex;
  return literalIndex;
}

function getLiteralVerseMap(bookId, chapter) {
  if (!state.literalIndex) return { csvBook: '', map: new Map() };
  const csvBook = CSV_BOOK_OVERRIDES[bookId] || bookId.replace(/\s+/g, '_');
  const data = state.literalIndex[csvBook]?.[chapter] || {};
  const result = new Map();
  Object.entries(data).forEach(([verse, clauses]) => {
    result.set(Number(verse), clauses);
  });
  return { csvBook, map: result };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function translateWordOrder(value) {
  if (!value) return '';
  return value
    .split(/\s+/)
    .map((token) => WORD_ORDER_MAP[token] || `${token}`)
    .join(' · ');
}

function renderClauses(clauses, csvBook, chapter, verse) {
  return clauses
    .map((clause, idx) => {
      const text = escapeHtml(clause.koreanLiteral || '');
      const span = `<span class=\"clause\" data-book=\"${csvBook}\" data-chapter=\"${chapter}\" data-verse=\"${verse}\" data-idx=\"${idx}\">${text}</span>`;
      const sep = idx < clauses.length - 1 ? '<span class=\"clause-sep\">/</span>' : '';
      return `${span}${sep}`;
    })
    .join('');
}

function getClauseFromEl(el) {
  const book = el.dataset.book;
  const chapter = Number(el.dataset.chapter);
  const verse = Number(el.dataset.verse);
  const idx = Number(el.dataset.idx);
  if (!book || Number.isNaN(chapter) || Number.isNaN(verse) || Number.isNaN(idx)) return null;
  return state.literalIndex?.[book]?.[chapter]?.[verse]?.[idx] || null;
}

function renderTooltip(clause) {
  const rows = [];
  const addRow = (label, value, className = '') => {
    if (!value) return;
    rows.push(`<div class=\"tooltip-row\"><span class=\"tooltip-label\">${label}</span><span class=\"tooltip-value ${className}\">${escapeHtml(value)}</span></div>`);
  };
  addRow(CSV_LABELS['Clause Type'], clause.clauseType);
  addRow(CSV_LABELS['Mother Clause Type'], clause.motherClauseType);
  addRow(CSV_LABELS['Predicted TAM'], clause.predictedTAM);
  addRow(CSV_LABELS['Word Order'], clause.wordOrderKo || clause.wordOrder);
  addRow(CSV_LABELS['Hebrew Text'], clause.hebrewText, 'hebrew');
  return `
    <button class=\"tooltip-close\" type=\"button\" aria-label=\"닫기\">×</button>
    <div class=\"tooltip-title\">직역 상세</div>
    ${rows.join('')}
  `;
}

function showTooltip(target, clause, pinned = false) {
  if (!clause) return;
  const key = `${clause.book}-${clause.chapter}-${clause.verse}-${clause.koreanLiteral}`;
  tooltipState.key = key;
  tooltipState.pinned = pinned;

  els.clauseTooltip.innerHTML = renderTooltip(clause);
  els.clauseTooltip.classList.toggle('pinned', pinned);
  els.clauseTooltip.style.display = 'block';
  els.clauseTooltip.setAttribute('aria-hidden', 'false');

  const rect = target.getBoundingClientRect();
  const tooltipRect = els.clauseTooltip.getBoundingClientRect();
  let top = rect.top - tooltipRect.height - 12;
  if (top < 12) top = rect.bottom + 12;
  let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - tooltipRect.width - 12));
  els.clauseTooltip.style.top = `${top}px`;
  els.clauseTooltip.style.left = `${left}px`;
}

function hideTooltip(force = false) {
  if (!force && tooltipState.pinned) return;
  tooltipState.pinned = false;
  tooltipState.key = null;
  els.clauseTooltip.style.display = 'none';
  els.clauseTooltip.setAttribute('aria-hidden', 'true');
}

function renderVerses(versesA, versesB, literalInfo) {
  const verseNumbers = new Set([
    ...versesA.keys(),
    ...versesB.keys(),
    ...literalInfo.map.keys(),
  ]);
  const sorted = Array.from(verseNumbers).sort((a, b) => a - b);

  if (!sorted.length) {
    els.verseList.innerHTML = '<div class="empty-state">해당 장을 찾을 수 없습니다.</div>';
    return;
  }

  const columnCount = state.showLiteral ? 3 : 2;
  els.columnHeaders.dataset.columns = String(columnCount);
  els.verseList.dataset.columns = String(columnCount);

  const rows = sorted
    .map((verse, idx) => {
      const textA = versesA.get(verse) || '';
      const textB = versesB.get(verse) || '';
      const clauses = literalInfo.map.get(verse) || [];

      const aClass = `${state.colA === 'BHS' ? 'bhs' : ''}`;
      const bClass = `${state.colB === 'BHS' ? 'bhs' : ''}`;
      const literalCell = state.showLiteral
        ? `<div class="verse-cell literal">${clauses.length ? renderClauses(clauses, literalInfo.csvBook, state.chapter, verse) : '<span class="missing">직역 없음</span>'}</div>`
        : '';

      return `
        <div class="verse-row" style="--i:${idx}">
          <div class="verse-num">${verse}</div>
          <div class="verse-cell ${aClass} ${textA ? '' : 'missing'}">${textA || '해당 역본 없음'}</div>
          <div class="verse-cell ${bClass} ${textB ? '' : 'missing'}">${textB || '해당 역본 없음'}</div>
          ${literalCell}
        </div>
      `;
    })
    .join('');

  els.verseList.innerHTML = rows;
}

async function render() {
  if (!state.bookId) return;
  hideTooltip(true);
  setLoading();
  updateChapterOptions();

  const book = state.index.books.find((b) => b.id === state.bookId);
  els.colALabel.textContent = state.index.translations[state.colA]?.label || state.colA;
  els.colBLabel.textContent = state.index.translations[state.colB]?.label || state.colB;
  els.colLiteralLabel.textContent = book?.name_ko ? `${book.name_ko} 직역` : '직역';
  els.colLiteralLabel.style.display = state.showLiteral ? 'block' : 'none';

  const [versesA, versesB] = await Promise.all([
    loadTranslation(state.colA, state.bookId, state.chapter),
    loadTranslation(state.colB, state.bookId, state.chapter),
  ]);

  let literalInfo = { csvBook: '', map: new Map() };
  if (state.showLiteral) {
    await loadLiteralIndex();
    literalInfo = getLiteralVerseMap(state.bookId, state.chapter);
  }

  renderVerses(versesA, versesB, literalInfo);
}

function bindEvents() {
  els.bookSelect.addEventListener('change', (e) => {
    state.bookId = e.target.value;
    state.chapter = 1;
    render();
  });

  els.chapterSelect.addEventListener('change', (e) => {
    state.chapter = Number(e.target.value);
    render();
  });

  els.colASelect.addEventListener('change', (e) => {
    state.colA = e.target.value;
    updateChapterOptions();
    render();
  });

  els.colBSelect.addEventListener('change', (e) => {
    state.colB = e.target.value;
    updateChapterOptions();
    render();
  });

  els.toggleLiteral.addEventListener('change', (e) => {
    state.showLiteral = e.target.checked;
    render();
  });

  els.prevChapter.addEventListener('click', () => {
    if (state.chapter > 1) {
      state.chapter -= 1;
      els.chapterSelect.value = String(state.chapter);
      render();
    }
  });

  els.nextChapter.addEventListener('click', () => {
    const maxChapter = Number(els.chapterSelect.options.length);
    if (state.chapter < maxChapter) {
      state.chapter += 1;
      els.chapterSelect.value = String(state.chapter);
      render();
    }
  });

  els.verseList.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const clauseEl = e.target.closest('.clause');
    if (!clauseEl) return;
    const clause = getClauseFromEl(clauseEl);
    showTooltip(clauseEl, clause, false);
  });

  els.verseList.addEventListener('pointerout', (e) => {
    if (tooltipState.pinned) return;
    const related = e.relatedTarget;
    if (related && (related.closest('.clause') || related.closest('#clauseTooltip'))) return;
    hideTooltip();
  });

  els.verseList.addEventListener('click', (e) => {
    const clauseEl = e.target.closest('.clause');
    if (!clauseEl) return;
    const clause = getClauseFromEl(clauseEl);
    if (!clause) return;
    const key = `${clause.book}-${clause.chapter}-${clause.verse}-${clause.koreanLiteral}`;
    if (tooltipState.pinned && tooltipState.key === key) {
      hideTooltip(true);
      return;
    }
    showTooltip(clauseEl, clause, true);
  });

  els.clauseTooltip.addEventListener('click', (e) => {
    if (e.target.classList.contains('tooltip-close')) {
      hideTooltip(true);
    }
  });

  document.addEventListener('click', (e) => {
    if (!tooltipState.pinned) return;
    if (e.target.closest('.clause') || e.target.closest('#clauseTooltip')) return;
    hideTooltip(true);
  });
}

(async function init() {
  await loadIndex();
  initSelectors();
  bindEvents();
  render();
})();
