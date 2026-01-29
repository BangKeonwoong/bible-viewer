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
  const res = await fetch(path);
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
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/^\uFEFF/, '');
    if (line.startsWith('Book;')) continue;
    const row = line.split(';');
    if (row.length < 3) continue;
    const book = row[0]?.trim();
    const chapter = Number(row[1]);
    const verse = Number(row[2]);
    const literal = row[row.length - 1]?.trim();
    if (!book || Number.isNaN(chapter) || Number.isNaN(verse) || !literal) continue;
    if (!literalIndex[book]) literalIndex[book] = {};
    if (!literalIndex[book][chapter]) literalIndex[book][chapter] = {};
    if (!literalIndex[book][chapter][verse]) literalIndex[book][chapter][verse] = [];
    literalIndex[book][chapter][verse].push(literal);
  }
  state.literalIndex = literalIndex;
  return literalIndex;
}

function getLiteralVerses(bookId, chapter) {
  if (!state.literalIndex) return new Map();
  const csvBook = CSV_BOOK_OVERRIDES[bookId] || bookId.replace(/\s+/g, '_');
  const data = state.literalIndex[csvBook]?.[chapter] || {};
  const result = new Map();
  Object.entries(data).forEach(([verse, clauses]) => {
    const value = clauses.join(' / ');
    result.set(Number(verse), value);
  });
  return result;
}

function renderVerses(versesA, versesB, literalVerses) {
  const verseNumbers = new Set([
    ...versesA.keys(),
    ...versesB.keys(),
    ...literalVerses.keys(),
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
      const textL = literalVerses.get(verse) || '';

      const aClass = `${state.colA === 'BHS' ? 'bhs' : ''}`;
      const bClass = `${state.colB === 'BHS' ? 'bhs' : ''}`;
      const literalCell = state.showLiteral
        ? `<div class="verse-cell literal">${textL || '<span class="missing">직역 없음</span>'}</div>`
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

  let literalVerses = new Map();
  if (state.showLiteral) {
    await loadLiteralIndex();
    literalVerses = getLiteralVerses(state.bookId, state.chapter);
  }

  renderVerses(versesA, versesB, literalVerses);
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
}

(async function init() {
  await loadIndex();
  initSelectors();
  bindEvents();
  render();
})();
