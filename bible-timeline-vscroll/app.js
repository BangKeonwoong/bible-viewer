(() => {
  const DATA_PATH = "./data/timeline.json";
  const ALL_LANE_ID = "ALL";
  const CARD_BASE_HEIGHT = 164;
  const CARD_EXPANDED_EXTRA = 150;
  const CARD_GAP = 18;
  const OVERSCAN = 8;

  const state = {
    meta: {},
    lanes: [],
    chapters: [],
    versesByChapter: {},
    edgesByTrack: {},
    chapterById: new Map(),
    chapterTrackSet: new Map(),
    selectedLaneId: ALL_LANE_ID,
    selectedChapterId: null,
    expandedChapterId: null,
    enabledTracks: new Set(),
    searchText: "",
    bookFilter: "ALL",
    showParallel: false,
    isTouch: false,
    pinned: false,
    visibleChapters: [],
    visibleIndexById: new Map(),
    virtualFramePending: false,
  };

  const laneTabsEl = document.getElementById("lane-tabs");
  const searchInputEl = document.getElementById("search-input");
  const bookFilterEl = document.getElementById("book-filter");
  const trackTogglesEl = document.getElementById("track-toggles");
  const parallelToggleEl = document.getElementById("parallel-toggle");
  const timelineScrollEl = document.getElementById("timeline-scroll");
  const timelineViewportEl = document.getElementById("timeline-viewport");
  const timelineVirtualEl = document.getElementById("timeline-virtual");
  const timelineAxisEl = document.getElementById("timeline-axis");
  const timelineLegendEl = document.getElementById("timeline-legend");
  const timelineTitleEl = document.getElementById("timeline-title");
  const resultCountEl = document.getElementById("result-count");
  const metaSummaryEl = document.getElementById("meta-summary");
  const tooltipEl = document.getElementById("tooltip");
  const detailContentEl = document.getElementById("detail-content");
  const clearSelectionEl = document.getElementById("clear-selection");

  const certaintyColor = {
    high: "#114f8d",
    medium: "#2d8a59",
    low: "#d06f2f",
    disputed: "#8b2d2d",
  };

  const trackNameMap = {
    track_main: "기본 흐름",
    track_exodus_early: "출애굽 해석 A",
    track_exodus_late: "출애굽 해석 B",
    track_gospel_harmony: "복음서 병행",
  };

  const trackColorMap = {
    track_main: "#5e759c",
    track_exodus_early: "#0a7ea4",
    track_exodus_late: "#d06f2f",
    track_gospel_harmony: "#2d8a59",
  };

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function truncate(text, max) {
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 1))}…`;
  }

  function normalizeCertainty(value) {
    const lower = String(value || "medium").toLowerCase();
    if (lower === "high" || lower === "medium" || lower === "low" || lower === "disputed") {
      return lower;
    }
    return "medium";
  }

  function trackClass(trackId) {
    return `track-${String(trackId).replace(/^track_/, "").replaceAll("_", "-")}`;
  }

  function getTrackColor(trackId) {
    return trackColorMap[trackId] || "#6f7d94";
  }

  function normalizeVerseItem(item, fallbackTier) {
    const tierRaw = String(item.evidence_tier || item.tier || fallbackTier || "direct").toLowerCase();
    const tier = tierRaw === "parallel" ? "parallel" : "direct";
    return {
      reference: String(item.reference || "").trim(),
      verse_text_kr: String(item.verse_text_kr || item.text || "").trim(),
      evidence_tier: tier,
      note: String(item.note || "").trim(),
    };
  }

  function normalizeVerseBucket(bucket) {
    if (!bucket) return [];

    if (Array.isArray(bucket)) {
      return bucket.map((item) => normalizeVerseItem(item, item.evidence_tier || "direct"));
    }

    const direct = Array.isArray(bucket.direct)
      ? bucket.direct.map((item) => normalizeVerseItem(item, "direct"))
      : [];
    const parallel = Array.isArray(bucket.parallel)
      ? bucket.parallel.map((item) => normalizeVerseItem(item, "parallel"))
      : [];
    return [...direct, ...parallel];
  }

  function normalizeVersesByChapter(payload) {
    const source = payload.versesByChapter || payload.evidenceByEvent || {};
    const normalized = {};

    Object.entries(source).forEach(([chapterId, bucket]) => {
      normalized[chapterId] = normalizeVerseBucket(bucket);
    });

    return normalized;
  }

  function normalizeChapter(rawChapter, index) {
    const chapterId = String(rawChapter.chapter_id || rawChapter.event_id || `CH${index + 1}`);
    const sequenceFallback = index + 1;
    const sequence = Number(rawChapter.sequence_index || rawChapter.chapter_index || sequenceFallback);
    const book = String(rawChapter.book || "").trim();

    return {
      chapter_id: chapterId,
      lane_tag: String(rawChapter.lane_tag || rawChapter.lane_id || "").trim(),
      sequence_index: Number.isFinite(sequence) ? sequence : sequenceFallback,
      book,
      event_title: String(
        rawChapter.event_title || rawChapter.chapter_title || rawChapter.title || rawChapter.reference || chapterId
      ).trim(),
      event_summary: String(rawChapter.event_summary || rawChapter.summary || "").trim(),
      certainty_level: normalizeCertainty(rawChapter.certainty_level),
      reference: String(rawChapter.reference || rawChapter.chapter_reference || "").trim(),
      search_blob: "",
    };
  }

  function normalizeLanes(rawLanes, chapters) {
    const laneMap = new Map();

    if (Array.isArray(rawLanes)) {
      rawLanes.forEach((lane, index) => {
        const laneId = String(lane.id || lane.lane_id || "").trim();
        if (!laneId) return;
        laneMap.set(laneId, {
          id: laneId,
          label: String(lane.label || lane.name || laneId).trim(),
          order: Number(lane.order ?? index + 1),
        });
      });
    }

    const used = new Set(chapters.map((chapter) => chapter.lane_tag).filter(Boolean));
    used.forEach((laneId) => {
      if (!laneMap.has(laneId)) {
        laneMap.set(laneId, {
          id: laneId,
          label: laneId,
          order: laneMap.size + 1,
        });
      }
    });

    return Array.from(laneMap.values()).sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.label.localeCompare(b.label, "ko");
    });
  }

  function buildSearchBlob(chapter, verseList) {
    const references = verseList.map((verse) => verse.reference).join(" ");
    return `${chapter.event_title} ${chapter.event_summary} ${chapter.reference} ${references}`.toLowerCase();
  }

  function normalizePayload(payload) {
    const rawChapters = Array.isArray(payload.chapters)
      ? payload.chapters
      : Array.isArray(payload.events)
        ? payload.events
        : [];

    const versesByChapter = normalizeVersesByChapter(payload);
    const chapters = rawChapters
      .map((raw, index) => normalizeChapter(raw, index))
      .sort((a, b) => a.sequence_index - b.sequence_index || a.chapter_id.localeCompare(b.chapter_id));

    chapters.forEach((chapter) => {
      const verses = versesByChapter[chapter.chapter_id] || [];
      if (!chapter.reference && verses[0]?.reference) {
        chapter.reference = String(verses[0].reference);
      }
      if (!chapter.event_summary && verses[0]?.verse_text_kr) {
        chapter.event_summary = truncate(String(verses[0].verse_text_kr), 140);
      }
      if (!chapter.book && chapter.reference.includes(" ")) {
        chapter.book = chapter.reference.split(" ")[0];
      }
      chapter.search_blob = buildSearchBlob(chapter, verses);
    });

    const lanes = normalizeLanes(payload.lanes, chapters);
    const edgesByTrack = payload.edgesByTrack && typeof payload.edgesByTrack === "object" ? payload.edgesByTrack : {};

    return {
      meta: payload.meta || {},
      lanes,
      chapters,
      versesByChapter,
      edgesByTrack,
    };
  }

  function getLaneLabel(laneId) {
    if (laneId === ALL_LANE_ID) return "전체보기";
    const lane = state.lanes.find((item) => item.id === laneId);
    return lane ? lane.label : laneId;
  }

  function getRepresentativeReference(chapterId) {
    const chapter = state.chapterById.get(chapterId);
    if (!chapter) return "근거 없음";
    const verseList = state.versesByChapter[chapterId] || [];
    return chapter.reference || verseList[0]?.reference || "근거 없음";
  }

  function splitVersesByTier(chapterId) {
    const verseList = state.versesByChapter[chapterId] || [];
    const direct = [];
    const parallel = [];

    verseList.forEach((verse) => {
      if (verse.evidence_tier === "parallel") parallel.push(verse);
      else direct.push(verse);
    });

    return { direct, parallel };
  }

  function buildTrackParticipationMap() {
    const map = new Map();

    Object.entries(state.edgesByTrack).forEach(([trackId, edges]) => {
      (edges || []).forEach((edge) => {
        const fromId = String(edge.from_chapter_id || edge.from_event_id || edge.from_id || "").trim();
        const toId = String(edge.to_chapter_id || edge.to_event_id || edge.to_id || "").trim();
        if (!fromId || !toId) return;

        if (!map.has(fromId)) map.set(fromId, new Set());
        if (!map.has(toId)) map.set(toId, new Set());
        map.get(fromId).add(trackId);
        map.get(toId).add(trackId);
      });
    });

    state.chapterTrackSet = map;
  }

  function getFilteredChapters() {
    const keyword = state.searchText.trim().toLowerCase();

    return state.chapters
      .filter((chapter) => {
        if (state.selectedLaneId === ALL_LANE_ID) return true;
        return chapter.lane_tag === state.selectedLaneId;
      })
      .filter((chapter) => {
        if (state.bookFilter === "ALL") return true;
        return chapter.book === state.bookFilter;
      })
      .filter((chapter) => {
        if (!keyword) return true;
        return chapter.search_blob.includes(keyword);
      });
  }

  function ensureSelectedChapter(chapters, options = {}) {
    const { preferFirst = false } = options;

    if (!chapters.length) {
      state.selectedChapterId = null;
      state.expandedChapterId = null;
      return;
    }

    const selectedVisible = chapters.some((chapter) => chapter.chapter_id === state.selectedChapterId);
    if (!selectedVisible || preferFirst) {
      state.selectedChapterId = chapters[0].chapter_id;
    }

    const expandedVisible = chapters.some((chapter) => chapter.chapter_id === state.expandedChapterId);
    if (!expandedVisible) {
      state.expandedChapterId = null;
    }
  }

  function renderLaneTabs() {
    const tabs = [{ id: ALL_LANE_ID, label: "전체보기" }, ...state.lanes];
    laneTabsEl.innerHTML = "";

    tabs.forEach((lane) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `lane-tab${lane.id === state.selectedLaneId ? " active" : ""}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", lane.id === state.selectedLaneId ? "true" : "false");
      button.textContent = lane.label;

      button.addEventListener("click", () => {
        state.selectedLaneId = lane.id;
        state.pinned = false;
        hideTooltip(true);
        renderAll({ resetScrollTop: true });
      });

      laneTabsEl.appendChild(button);
    });
  }

  function renderBookFilter() {
    const books = [];
    const seen = new Set();

    state.chapters.forEach((chapter) => {
      if (!chapter.book || seen.has(chapter.book)) return;
      seen.add(chapter.book);
      books.push(chapter.book);
    });

    const fragment = document.createDocumentFragment();

    const allOption = document.createElement("option");
    allOption.value = "ALL";
    allOption.textContent = "전체 책";
    fragment.appendChild(allOption);

    books.forEach((book) => {
      const option = document.createElement("option");
      option.value = book;
      option.textContent = book;
      fragment.appendChild(option);
    });

    bookFilterEl.innerHTML = "";
    bookFilterEl.appendChild(fragment);

    if (state.bookFilter !== "ALL" && !seen.has(state.bookFilter)) {
      state.bookFilter = "ALL";
    }
    bookFilterEl.value = state.bookFilter;
  }

  function renderTrackToggles() {
    const tracks = Object.keys(state.edgesByTrack).sort((a, b) => {
      if (a === "track_main") return -1;
      if (b === "track_main") return 1;
      return a.localeCompare(b);
    });

    if (!tracks.length) {
      trackTogglesEl.innerHTML = '<span class="track-empty">트랙 데이터 없음</span>';
      return;
    }

    if (!state.enabledTracks.size) {
      if (tracks.includes("track_main")) state.enabledTracks.add("track_main");
      else state.enabledTracks.add(tracks[0]);
    }

    trackTogglesEl.innerHTML = "";

    tracks.forEach((trackId) => {
      const label = document.createElement("label");
      label.className = "track-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.enabledTracks.has(trackId);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.enabledTracks.add(trackId);
        else state.enabledTracks.delete(trackId);

        if (!state.enabledTracks.size) {
          const fallback = tracks.includes("track_main") ? "track_main" : tracks[0];
          state.enabledTracks.add(fallback);
        }

        renderTrackToggles();
        renderTimelineLegend();
        requestVirtualRender();
      });

      const colorDot = document.createElement("span");
      colorDot.className = `track-dot ${trackClass(trackId)}`;
      colorDot.style.setProperty("--track-color", getTrackColor(trackId));

      const text = document.createElement("span");
      text.textContent = trackNameMap[trackId] || trackId;

      label.appendChild(checkbox);
      label.appendChild(colorDot);
      label.appendChild(text);
      trackTogglesEl.appendChild(label);
    });
  }

  function renderTimelineLegend() {
    const enabled = Object.keys(state.edgesByTrack).filter((trackId) => state.enabledTracks.has(trackId));

    if (!enabled.length) {
      timelineLegendEl.innerHTML = '<span class="legend-empty">표시 중인 트랙 없음</span>';
      return;
    }

    timelineLegendEl.innerHTML = enabled
      .map((trackId) => {
        const count = (state.edgesByTrack[trackId] || []).length;
        const label = trackNameMap[trackId] || trackId;
        return `
          <span class="legend-item">
            <i class="legend-swatch ${trackClass(trackId)}" style="--track-color:${escapeHtml(getTrackColor(trackId))}"></i>
            <span>${escapeHtml(label)}</span>
            <em>${count}</em>
          </span>
        `;
      })
      .join("");
  }

  function updateMetaSummary() {
    const translation = String(state.meta.translation || "N/A");
    const totalChapters = state.chapters.length;
    const totalVerses = Object.values(state.versesByChapter).reduce((sum, list) => sum + list.length, 0);
    const mode = String(state.meta.mode || "unknown");

    const modeText = mode === "all_verses" ? "all_verses(장 단위 카드)" : mode;
    metaSummaryEl.textContent = `총 ${totalChapters}장 · 근거구절 ${totalVerses}개 · 번역 ${translation} · ${modeText}`;
  }

  function positionTooltip(pointerEvent) {
    const cardRect = timelineScrollEl.parentElement.getBoundingClientRect();
    const rawLeft = pointerEvent.clientX - cardRect.left + 16;
    const rawTop = pointerEvent.clientY - cardRect.top + 16;

    const clampedLeft = Math.min(Math.max(8, rawLeft), Math.max(8, cardRect.width - 250));
    const clampedTop = Math.min(Math.max(8, rawTop), Math.max(8, cardRect.height - 120));

    tooltipEl.style.left = `${clampedLeft}px`;
    tooltipEl.style.top = `${clampedTop}px`;
  }

  function showTooltip(pointerEvent, chapter) {
    const repRef = getRepresentativeReference(chapter.chapter_id);
    tooltipEl.innerHTML = `
      <strong>${escapeHtml(chapter.event_title)}</strong>
      <span>${escapeHtml(chapter.book || "책 정보 없음")} · #${chapter.sequence_index}</span>
      <span>${escapeHtml(repRef)}</span>
    `;
    tooltipEl.classList.remove("hidden");
    positionTooltip(pointerEvent);
  }

  function hideTooltip(force = false) {
    if (!force && state.isTouch && state.pinned) return;
    tooltipEl.classList.add("hidden");
  }

  function getExpandedIndex() {
    if (!state.expandedChapterId) return -1;
    const idx = state.visibleIndexById.get(state.expandedChapterId);
    return Number.isInteger(idx) ? idx : -1;
  }

  function topForIndex(index, expandedIndex) {
    const extra = expandedIndex >= 0 && index > expandedIndex ? CARD_EXPANDED_EXTRA : 0;
    return index * (CARD_BASE_HEIGHT + CARD_GAP) + extra;
  }

  function cardHeightForIndex(index, expandedIndex) {
    if (index === expandedIndex) {
      return CARD_BASE_HEIGHT + CARD_EXPANDED_EXTRA;
    }
    return CARD_BASE_HEIGHT;
  }

  function totalHeightForCount(count, expandedIndex) {
    if (count <= 0) return 320;
    const baseTotal = count * CARD_BASE_HEIGHT + (count - 1) * CARD_GAP;
    const extra = expandedIndex >= 0 ? CARD_EXPANDED_EXTRA : 0;
    return baseTotal + extra + 24;
  }

  function findStartIndex(targetTop, count, expandedIndex) {
    let lo = 0;
    let hi = count - 1;
    let ans = count;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const midBottom = topForIndex(mid, expandedIndex) + cardHeightForIndex(mid, expandedIndex);
      if (midBottom < targetTop) {
        lo = mid + 1;
      } else {
        ans = mid;
        hi = mid - 1;
      }
    }

    return Math.min(Math.max(0, ans), Math.max(0, count - 1));
  }

  function findEndIndex(targetBottom, count, expandedIndex, start) {
    let lo = start;
    let hi = count - 1;
    let ans = start;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const midTop = topForIndex(mid, expandedIndex);
      if (midTop <= targetBottom) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return Math.min(Math.max(start, ans), Math.max(0, count - 1));
  }

  function scrollChapterIntoView(chapterId, behavior = "smooth") {
    const idx = state.visibleIndexById.get(chapterId);
    if (!Number.isInteger(idx)) return;

    const expandedIndex = getExpandedIndex();
    const top = topForIndex(idx, expandedIndex);
    const height = cardHeightForIndex(idx, expandedIndex);

    const viewportTop = timelineScrollEl.scrollTop;
    const viewportBottom = viewportTop + timelineScrollEl.clientHeight;

    if (top >= viewportTop + 10 && top + height <= viewportBottom - 10) {
      return;
    }

    const target = Math.max(0, top - Math.max(20, timelineScrollEl.clientHeight * 0.2));
    timelineScrollEl.scrollTo({ top: target, behavior });
  }

  function requestVirtualRender() {
    if (state.virtualFramePending) return;
    state.virtualFramePending = true;

    window.requestAnimationFrame(() => {
      state.virtualFramePending = false;
      renderVirtualizedChapters();
    });
  }

  function createSideTrackMarkers(chapterId) {
    const tracks = state.chapterTrackSet.get(chapterId);
    if (!tracks || !tracks.size) return "";

    const visibleTracks = Array.from(tracks).filter((trackId) => state.enabledTracks.has(trackId));
    if (!visibleTracks.length) {
      return "";
    }

    return visibleTracks
      .slice(0, 4)
      .map((trackId) => {
        const label = trackNameMap[trackId] || trackId;
        return `
          <i class="track-dot ${trackClass(trackId)}" title="${escapeHtml(label)}" style="--track-color:${escapeHtml(getTrackColor(trackId))}"></i>
        `;
      })
      .join("");
  }

  function renderExpandedPreview(chapterId) {
    const { direct, parallel } = splitVersesByTier(chapterId);
    const items = direct.slice(0, 2);

    if (!items.length) {
      return '<p class="chapter-preview-empty">표시할 Direct 근거가 없습니다.</p>';
    }

    const previewItems = items
      .map(
        (verse) => `
          <li>
            <strong>${escapeHtml(verse.reference)}</strong>
            <p>${escapeHtml(truncate(verse.verse_text_kr || "", 120))}</p>
          </li>
        `
      )
      .join("");

    return `
      <ul class="chapter-preview-list">${previewItems}</ul>
      <p class="chapter-preview-meta">Direct ${direct.length} · Parallel ${parallel.length}</p>
    `;
  }

  function renderChapterCard(chapter, index, top, expandedIndex, singleColumn) {
    const card = document.createElement("article");
    const isSelected = chapter.chapter_id === state.selectedChapterId;
    const isExpanded = chapter.chapter_id === state.expandedChapterId;
    const sideClass = singleColumn ? "single" : index % 2 === 0 ? "left" : "right";

    card.className = `chapter-card ${sideClass}${isSelected ? " selected" : ""}${isExpanded ? " expanded" : ""}`;
    card.style.top = `${top}px`;
    card.style.height = `${cardHeightForIndex(index, expandedIndex)}px`;
    card.setAttribute("data-chapter-id", chapter.chapter_id);

    const reference = getRepresentativeReference(chapter.chapter_id);
    const certainty = normalizeCertainty(chapter.certainty_level);
    const certaintyLabel = `확실성 ${certainty}`;

    card.innerHTML = `
      <div class="chapter-node" style="--node-color:${escapeHtml(certaintyColor[certainty] || certaintyColor.medium)}"></div>
      <div class="chapter-side-tracks">${createSideTrackMarkers(chapter.chapter_id)}</div>
      <div class="chapter-surface">
        <div class="chapter-head">
          <span class="chapter-seq">#${chapter.sequence_index}</span>
          <span class="chapter-ref">${escapeHtml(reference)}</span>
        </div>
        <h3 class="chapter-title">${escapeHtml(chapter.event_title)}</h3>
        <p class="chapter-summary">${escapeHtml(truncate(chapter.event_summary || "요약 없음", isExpanded ? 220 : 120))}</p>
        <div class="chapter-meta">
          <span class="badge">${escapeHtml(chapter.book || "미상")}</span>
          <span class="badge ${`cert-${certainty}`}">${escapeHtml(certaintyLabel)}</span>
        </div>
        <div class="chapter-expand">${isExpanded ? renderExpandedPreview(chapter.chapter_id) : ""}</div>
        <div class="chapter-actions">
          <button type="button" class="expand-btn" aria-expanded="${isExpanded ? "true" : "false"}">
            ${isExpanded ? "접기" : "확장"}
          </button>
        </div>
      </div>
    `;

    card.addEventListener("pointerenter", (event) => {
      if (state.isTouch) return;
      state.selectedChapterId = chapter.chapter_id;
      state.pinned = false;
      renderDetail();
      requestVirtualRender();
      showTooltip(event, chapter);
    });

    card.addEventListener("pointermove", (event) => {
      if (state.isTouch) return;
      positionTooltip(event);
    });

    card.addEventListener("pointerleave", () => {
      if (state.isTouch) return;
      hideTooltip();
    });

    card.addEventListener("click", (event) => {
      const expandButton = event.target.closest(".expand-btn");
      if (expandButton) {
        state.expandedChapterId = state.expandedChapterId === chapter.chapter_id ? null : chapter.chapter_id;
        state.selectedChapterId = chapter.chapter_id;
        renderDetail();
        requestVirtualRender();
        return;
      }

      state.selectedChapterId = chapter.chapter_id;
      renderDetail();
      requestVirtualRender();

      if (state.isTouch) {
        state.pinned = true;
        showTooltip(event, chapter);
      }
    });

    return card;
  }

  function renderNoResult(totalHeight) {
    timelineViewportEl.style.height = `${totalHeight}px`;
    timelineAxisEl.style.height = `${Math.max(180, totalHeight - 20)}px`;
    timelineVirtualEl.innerHTML = '<div class="no-result">현재 필터 조건에서 표시할 장이 없습니다.</div>';
  }

  function renderVirtualizedChapters() {
    const count = state.visibleChapters.length;
    const expandedIndex = getExpandedIndex();
    const totalHeight = totalHeightForCount(count, expandedIndex);

    if (!count) {
      renderNoResult(totalHeight);
      return;
    }

    const viewportHeight = Math.max(1, timelineScrollEl.clientHeight);
    const scrollTop = timelineScrollEl.scrollTop;
    const overscanPx = OVERSCAN * (CARD_BASE_HEIGHT + CARD_GAP);

    const windowTop = Math.max(0, scrollTop - overscanPx);
    const windowBottom = scrollTop + viewportHeight + overscanPx;

    const start = findStartIndex(windowTop, count, expandedIndex);
    const end = findEndIndex(windowBottom, count, expandedIndex, start);

    timelineViewportEl.style.height = `${totalHeight}px`;
    timelineAxisEl.style.height = `${Math.max(180, totalHeight - 20)}px`;
    timelineVirtualEl.innerHTML = "";

    const fragment = document.createDocumentFragment();
    const singleColumn = window.matchMedia("(max-width: 900px)").matches;

    for (let idx = start; idx <= end; idx += 1) {
      const chapter = state.visibleChapters[idx];
      const top = topForIndex(idx, expandedIndex);
      fragment.appendChild(renderChapterCard(chapter, idx, top, expandedIndex, singleColumn));
    }

    timelineVirtualEl.appendChild(fragment);
  }

  function renderEvidenceList(items) {
    if (!items.length) {
      return '<p class="empty">표시할 근거 구절이 없습니다.</p>';
    }

    return `
      <ul class="verse-list">
        ${items
          .map(
            (item) => `
              <li class="verse-item">
                <strong>${escapeHtml(item.reference)}</strong>
                <p>${escapeHtml(item.verse_text_kr)}</p>
              </li>
            `
          )
          .join("")}
      </ul>
    `;
  }

  function renderDetail() {
    if (!state.selectedChapterId) {
      detailContentEl.innerHTML =
        '<p class="empty">타임라인 장 카드를 호버(모바일: 탭)하면 근거 구절이 여기에 표시됩니다.</p>';
      return;
    }

    const chapter = state.chapterById.get(state.selectedChapterId);
    if (!chapter) {
      detailContentEl.innerHTML = '<p class="empty">선택된 장 정보를 찾을 수 없습니다.</p>';
      return;
    }

    const { direct, parallel } = splitVersesByTier(chapter.chapter_id);
    const certainty = normalizeCertainty(chapter.certainty_level);
    const certaintyClass = `cert-${certainty}`;
    const certaintyLabel = `확실성 ${certainty}`;

    const parallelBlock = state.showParallel
      ? `
        <h4 class="section-title">Parallel 근거 (${parallel.length})</h4>
        ${renderEvidenceList(parallel)}
      `
      : `
        <h4 class="section-title">Parallel 근거 (${parallel.length})</h4>
        <p class="empty">상단의 "병행근거 표시" 토글을 켜면 병행 구절이 표시됩니다.</p>
      `;

    detailContentEl.innerHTML = `
      <h3 class="detail-event-title">${escapeHtml(chapter.event_title)}</h3>
      <div class="meta-line">
        <span class="badge">${escapeHtml(chapter.book || "미상")}</span>
        <span class="badge">#${chapter.sequence_index}</span>
        <span class="badge">${escapeHtml(getLaneLabel(chapter.lane_tag || ""))}</span>
        <span class="badge ${certaintyClass}">${escapeHtml(certaintyLabel)}</span>
      </div>
      <p class="detail-summary">${escapeHtml(chapter.event_summary || "요약 없음")}</p>

      <h4 class="section-title">Direct 근거 (${direct.length})</h4>
      ${renderEvidenceList(direct)}

      ${parallelBlock}
    `;
  }

  function renderAll(options = {}) {
    const {
      preferFirst = false,
      resetScrollTop = false,
      autoScrollToSelection = false,
      scrollBehavior = "smooth",
    } = options;

    state.visibleChapters = getFilteredChapters();
    state.visibleIndexById = new Map(
      state.visibleChapters.map((chapter, idx) => [chapter.chapter_id, idx])
    );

    ensureSelectedChapter(state.visibleChapters, { preferFirst });

    renderLaneTabs();

    const laneLabel = getLaneLabel(state.selectedLaneId);
    timelineTitleEl.textContent = `${laneLabel} 도식`;
    resultCountEl.textContent = `${state.visibleChapters.length}개 장`;

    renderTimelineLegend();
    renderDetail();

    if (resetScrollTop) {
      timelineScrollEl.scrollTop = 0;
    }

    requestVirtualRender();

    if (autoScrollToSelection && state.selectedChapterId) {
      window.requestAnimationFrame(() => {
        scrollChapterIntoView(state.selectedChapterId, scrollBehavior);
      });
    }
  }

  function bindControls() {
    searchInputEl.addEventListener("input", () => {
      state.searchText = searchInputEl.value;
      state.pinned = false;
      hideTooltip(true);

      const hasKeyword = state.searchText.trim().length > 0;
      renderAll({
        preferFirst: hasKeyword,
        autoScrollToSelection: hasKeyword,
        scrollBehavior: "smooth",
      });
    });

    bookFilterEl.addEventListener("change", () => {
      state.bookFilter = bookFilterEl.value;
      state.pinned = false;
      hideTooltip(true);
      renderAll({ resetScrollTop: true });
    });

    parallelToggleEl.addEventListener("change", () => {
      state.showParallel = parallelToggleEl.checked;
      renderDetail();
    });

    clearSelectionEl.addEventListener("click", () => {
      state.selectedChapterId = null;
      state.expandedChapterId = null;
      state.pinned = false;
      hideTooltip(true);
      renderDetail();
      requestVirtualRender();
    });

    timelineScrollEl.addEventListener("scroll", () => {
      requestVirtualRender();
      hideTooltip();
    });

    window.addEventListener("resize", () => {
      hideTooltip(true);
      requestVirtualRender();
    });
  }

  async function init() {
    state.isTouch = window.matchMedia("(hover: none), (pointer: coarse)").matches;

    let payload;
    try {
      const response = await fetch(DATA_PATH);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      payload = await response.json();
    } catch (error) {
      metaSummaryEl.textContent = "데이터 로딩 실패";
      detailContentEl.innerHTML = `<p class="empty">timeline.json을 불러오지 못했습니다: ${escapeHtml(error.message)}</p>`;
      return;
    }

    const normalized = normalizePayload(payload);

    state.meta = normalized.meta;
    state.lanes = normalized.lanes;
    state.chapters = normalized.chapters;
    state.versesByChapter = normalized.versesByChapter;
    state.edgesByTrack = normalized.edgesByTrack;
    state.chapterById = new Map(normalized.chapters.map((chapter) => [chapter.chapter_id, chapter]));
    buildTrackParticipationMap();

    const tracks = Object.keys(state.edgesByTrack);
    if (tracks.includes("track_main")) {
      state.enabledTracks = new Set(["track_main"]);
    } else if (tracks.length) {
      state.enabledTracks = new Set([tracks[0]]);
    }

    state.selectedLaneId = ALL_LANE_ID;
    state.selectedChapterId = state.chapters[0]?.chapter_id || null;
    state.expandedChapterId = null;

    updateMetaSummary();
    renderBookFilter();
    renderTrackToggles();
    bindControls();
    renderAll({ resetScrollTop: true });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
