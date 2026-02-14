#!/usr/bin/env python3
"""Build a Bible-only timeline research package for infographic production.

Outputs:
- research/events.csv
- research/evidence_verses.csv
- research/chronology_edges.csv
- research/interpretation_tracks.csv
- research/research_notes.md
- research/infographic_mapping.md
"""

from __future__ import annotations

import argparse
import csv
import glob
import os
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

FILENAME_RE = re.compile(r"^([12])-(\d{2})(.+)\.txt$")
VERSE_RE = re.compile(r"^([^\d]+?)(\d+):(\d+)\s+(.*)$")
HEADING_RE = re.compile(r"^\s*<([^>]+)>\s*(.*)$")

TARGET_EVENTS = 320
TRANSLATION = "개역개정"

NARRATIVE_BOOKS = {
    "창세기",
    "출애굽기",
    "민수기",
    "신명기",
    "여호수아",
    "사사기",
    "룻기",
    "사무엘상",
    "사무엘하",
    "열왕기상",
    "열왕기하",
    "역대상",
    "역대하",
    "에스라",
    "느헤미야",
    "에스더",
    "다니엘",
    "요나",
    "마태복음",
    "마가복음",
    "누가복음",
    "요한복음",
    "사도행전",
}

GOSPEL_BOOKS = {"마태복음", "마가복음", "누가복음", "요한복음"}

AMBIGUOUS_KEYWORDS = {
    "출애굽": "disputed",
    "성전": "medium",
    "재위": "medium",
    "통치": "medium",
    "탄생": "medium",
    "족보": "low",
    "계보": "low",
    "인구": "medium",
    "연대": "medium",
}


@dataclass
class Verse:
    testament: str
    canonical_order: int
    book_name: str
    book_abbr: str
    chapter: int
    verse: int
    text: str


@dataclass
class CandidateEvent:
    testament: str
    canonical_order: int
    book_name: str
    title: str
    first_text: str
    start_ref: str
    start_chapter: int
    start_verse: int
    end_ref: str
    verse_slice: List[Verse]


def normalize_text(value: str) -> str:
    return unicodedata.normalize("NFC", value.strip())


def clean_heading_prefix(text: str) -> str:
    text = text.strip()
    while True:
        match = HEADING_RE.match(text)
        if not match:
            return text
        text = match.group(2).strip()


def normalize_heading_key(title: str) -> str:
    key = re.sub(r"[^가-힣A-Za-z0-9]+", "", title)
    return normalize_text(key)


def discover_source_dir(explicit: str | None = None) -> Path:
    if explicit:
        path = Path(explicit).expanduser()
        if path.is_dir():
            return path
        raise FileNotFoundError(f"지정한 source_dir를 찾을 수 없습니다: {explicit}")

    patterns = [
        "/Users/daniel/Documents/*MacBook*2/원어연구/개역개정-pdf, txt/개역개정-text",
        "/Users/daniel/Library/CloudStorage/GoogleDrive-*/**/개역개정-pdf, txt/개역개정-text",
        "/Users/daniel/Documents/**/개역개정-text",
    ]

    candidates: List[str] = []
    for pattern in patterns:
        candidates.extend(glob.glob(pattern, recursive=True))

    checked: List[Path] = []
    for raw in sorted(set(candidates)):
        path = Path(raw)
        if not path.is_dir():
            continue
        txt_files = [p for p in path.iterdir() if p.suffix.lower() == ".txt" and FILENAME_RE.match(p.name)]
        if len(txt_files) >= 66:
            return path
        checked.append(path)

    scanned = "\n".join(str(p) for p in checked[:20])
    raise FileNotFoundError(
        "개역개정-text 소스 폴더를 찾지 못했습니다. --source-dir 옵션으로 지정하세요.\n"
        f"검사한 경로(일부):\n{scanned}"
    )


def load_verses(source_dir: Path) -> Tuple[Dict[str, List[Verse]], Dict[str, int], Dict[str, str]]:
    by_book: Dict[str, List[Verse]] = defaultdict(list)
    canonical_order_map: Dict[str, int] = {}
    testament_map: Dict[str, str] = {}

    for file_path in sorted(source_dir.iterdir()):
        if file_path.suffix.lower() != ".txt":
            continue
        match = FILENAME_RE.match(file_path.name)
        if not match:
            continue

        testament_marker = match.group(1)
        order_in_testament = int(match.group(2))
        book_name = normalize_text(match.group(3))
        testament = "OT" if testament_marker == "1" else "NT"
        canonical_order = order_in_testament if testament == "OT" else 39 + order_in_testament

        canonical_order_map[book_name] = canonical_order
        testament_map[book_name] = testament

        with file_path.open("r", encoding="cp949", errors="strict") as handle:
            for raw in handle:
                line = normalize_text(raw)
                if not line:
                    continue
                verse_match = VERSE_RE.match(line)
                if not verse_match:
                    continue

                book_abbr = normalize_text(verse_match.group(1))
                chapter = int(verse_match.group(2))
                verse = int(verse_match.group(3))
                text = normalize_text(verse_match.group(4))

                by_book[book_name].append(
                    Verse(
                        testament=testament,
                        canonical_order=canonical_order,
                        book_name=book_name,
                        book_abbr=book_abbr,
                        chapter=chapter,
                        verse=verse,
                        text=text,
                    )
                )

    if len(by_book) < 66:
        raise RuntimeError(f"66권 파싱 실패: {len(by_book)}권만 읽었습니다.")

    for book, verses in by_book.items():
        verses.sort(key=lambda v: (v.chapter, v.verse))

    return by_book, canonical_order_map, testament_map


def build_candidate_events(by_book: Dict[str, List[Verse]]) -> List[CandidateEvent]:
    candidates: List[CandidateEvent] = []

    for book_name, verses in by_book.items():
        if book_name not in NARRATIVE_BOOKS:
            continue

        heading_positions: List[Tuple[int, str, str]] = []

        for idx, verse in enumerate(verses):
            heading_match = HEADING_RE.match(verse.text)
            if not heading_match:
                continue

            title = normalize_text(heading_match.group(1))
            body = normalize_text(heading_match.group(2))
            heading_positions.append((idx, title, body))

        if not heading_positions:
            continue

        for i, (start_idx, title, first_text) in enumerate(heading_positions):
            end_idx = heading_positions[i + 1][0] - 1 if i + 1 < len(heading_positions) else len(verses) - 1
            verse_slice = verses[start_idx : end_idx + 1]
            if not verse_slice:
                continue

            start_verse = verse_slice[0]
            end_verse = verse_slice[-1]
            if not first_text:
                first_text = clean_heading_prefix(start_verse.text)

            candidates.append(
                CandidateEvent(
                    testament=start_verse.testament,
                    canonical_order=start_verse.canonical_order,
                    book_name=book_name,
                    title=title,
                    first_text=first_text,
                    start_ref=f"{book_name} {start_verse.chapter}:{start_verse.verse}",
                    start_chapter=start_verse.chapter,
                    start_verse=start_verse.verse,
                    end_ref=f"{book_name} {end_verse.chapter}:{end_verse.verse}",
                    verse_slice=verse_slice,
                )
            )

    candidates.sort(key=lambda c: (c.canonical_order, c.start_chapter, c.start_verse))
    return candidates


def proportional_quotas(group_counts: Dict[str, int], target: int) -> Dict[str, int]:
    total = sum(group_counts.values())
    if total == 0:
        return {book: 0 for book in group_counts}

    quotas = {book: max(1, int(target * cnt / total)) for book, cnt in group_counts.items()}
    quotas = {book: min(quotas[book], cnt) for book, cnt in group_counts.items()}

    current = sum(quotas.values())

    fractions = {
        book: (target * cnt / total) - int(target * cnt / total)
        for book, cnt in group_counts.items()
    }

    if current < target:
        expandable = [b for b in group_counts if quotas[b] < group_counts[b]]
        expandable.sort(key=lambda b: fractions[b], reverse=True)
        idx = 0
        while current < target and expandable:
            book = expandable[idx % len(expandable)]
            if quotas[book] < group_counts[book]:
                quotas[book] += 1
                current += 1
            idx += 1
            if idx > len(expandable) * (target + 2):
                break

    if current > target:
        reducible = [b for b in group_counts if quotas[b] > 1]
        reducible.sort(key=lambda b: fractions[b])
        idx = 0
        while current > target and reducible:
            book = reducible[idx % len(reducible)]
            if quotas[book] > 1:
                quotas[book] -= 1
                current -= 1
            idx += 1
            if idx > len(reducible) * (target + 2):
                break

    return quotas


def pick_evenly(items: List[CandidateEvent], quota: int) -> List[CandidateEvent]:
    if quota >= len(items):
        return list(items)
    if quota <= 0:
        return []
    if quota == 1:
        return [items[len(items) // 2]]

    selected: List[CandidateEvent] = []
    n = len(items)
    for i in range(quota):
        start = i * n // quota
        end = (i + 1) * n // quota
        idx = (start + max(start, end - 1)) // 2
        selected.append(items[idx])

    unique: List[CandidateEvent] = []
    seen = set()
    for item in selected:
        key = (item.book_name, item.start_ref)
        if key not in seen:
            seen.add(key)
            unique.append(item)

    while len(unique) < quota:
        for item in items:
            key = (item.book_name, item.start_ref)
            if key in seen:
                continue
            seen.add(key)
            unique.append(item)
            if len(unique) == quota:
                break

    unique.sort(key=lambda c: (c.canonical_order, c.start_chapter, c.start_verse))
    return unique


def lane_tag(book_name: str, chapter: int) -> str:
    if book_name == "창세기":
        return "primeval_history" if chapter <= 11 else "patriarchal_era"
    if book_name in {"출애굽기", "민수기", "신명기"}:
        return "exodus_wilderness"
    if book_name == "여호수아":
        return "conquest_settlement"
    if book_name in {"사사기", "룻기"}:
        return "judges_period"
    if book_name in {"사무엘상", "사무엘하"}:
        return "united_monarchy"
    if book_name in {"열왕기상", "열왕기하", "역대상", "역대하"}:
        return "monarchy_exile"
    if book_name in {"에스라", "느헤미야", "에스더", "다니엘"}:
        return "exile_return"
    if book_name == "요나":
        return "prophetic_mission"
    if book_name in GOSPEL_BOOKS:
        return "life_of_jesus"
    if book_name == "사도행전":
        return "early_church"
    return "other"


def certainty_level(title: str) -> str:
    for keyword, level in AMBIGUOUS_KEYWORDS.items():
        if keyword in title:
            return level
    return "high"


def summarize(text: str, limit: int = 88) -> str:
    text = normalize_text(text)
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def topological_ok(nodes: Iterable[str], edges: List[Tuple[str, str]]) -> bool:
    node_set = set(nodes)
    indeg = {n: 0 for n in node_set}
    outgoing: Dict[str, List[str]] = {n: [] for n in node_set}

    for src, dst in edges:
        if src not in node_set or dst not in node_set:
            continue
        outgoing[src].append(dst)
        indeg[dst] += 1

    queue = [n for n in node_set if indeg[n] == 0]
    visited = 0
    while queue:
        cur = queue.pop()
        visited += 1
        for nxt in outgoing[cur]:
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                queue.append(nxt)

    return visited == len(node_set)


def write_csv(path: Path, rows: List[Dict[str, str]], fieldnames: List[str]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", default=None, help="개역개정-text 폴더 경로")
    parser.add_argument("--output-dir", default="research", help="출력 폴더")
    args = parser.parse_args()

    source_dir = discover_source_dir(args.source_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    by_book, canonical_map, testament_map = load_verses(source_dir)
    candidates = build_candidate_events(by_book)

    grouped: Dict[str, List[CandidateEvent]] = defaultdict(list)
    for cand in candidates:
        grouped[cand.book_name].append(cand)

    group_counts = {book: len(items) for book, items in grouped.items()}
    quotas = proportional_quotas(group_counts, TARGET_EVENTS)

    selected_candidates: List[CandidateEvent] = []
    for book in sorted(grouped.keys(), key=lambda b: canonical_map[b]):
        selected_candidates.extend(pick_evenly(grouped[book], quotas.get(book, 0)))

    selected_candidates.sort(key=lambda c: (c.canonical_order, c.start_chapter, c.start_verse))

    events_rows: List[Dict[str, str]] = []
    event_objects: List[Tuple[str, CandidateEvent, str]] = []

    for seq, cand in enumerate(selected_candidates, start=1):
        event_id = f"EVT{seq:04d}"
        lane = lane_tag(cand.book_name, cand.start_chapter)
        level = certainty_level(cand.title)
        summary = summarize(cand.first_text or cand.title)
        events_rows.append(
            {
                "event_id": event_id,
                "testament": cand.testament,
                "book": cand.book_name,
                "event_title": cand.title,
                "event_summary": summary,
                "lane_tag": lane,
                "sequence_index": str(seq),
                "track_id": "track_main",
                "certainty_level": level,
            }
        )
        event_objects.append((event_id, cand, lane))

    evidence_rows: List[Dict[str, str]] = []
    evidence_id = 1

    for event_id, cand, _lane in event_objects:
        for idx, verse in enumerate(cand.verse_slice):
            verse_text = clean_heading_prefix(verse.text) if idx == 0 else verse.text
            evidence_rows.append(
                {
                    "evidence_id": f"EVD{evidence_id:07d}",
                    "event_id": event_id,
                    "evidence_tier": "direct",
                    "reference": f"{verse.book_name} {verse.chapter}:{verse.verse}",
                    "verse_text_kr": verse_text,
                    "translation": TRANSLATION,
                    "is_parallel": "false",
                    "note": "",
                }
            )
            evidence_id += 1

    # Parallel pass: for matching headings in synoptic/johannine sections.
    gospel_groups: Dict[str, List[Tuple[str, CandidateEvent]]] = defaultdict(list)
    for event_id, cand, _lane in event_objects:
        if cand.book_name in GOSPEL_BOOKS:
            key = normalize_heading_key(cand.title)
            if key:
                gospel_groups[key].append((event_id, cand))

    for _key, members in gospel_groups.items():
        books_in_group = {cand.book_name for _, cand in members}
        if len(books_in_group) < 2:
            continue

        for target_event_id, target_cand in members:
            for source_event_id, source_cand in members:
                if source_event_id == target_event_id:
                    continue
                for idx, verse in enumerate(source_cand.verse_slice):
                    verse_text = clean_heading_prefix(verse.text) if idx == 0 else verse.text
                    evidence_rows.append(
                        {
                            "evidence_id": f"EVD{evidence_id:07d}",
                            "event_id": target_event_id,
                            "evidence_tier": "parallel",
                            "reference": f"{verse.book_name} {verse.chapter}:{verse.verse}",
                            "verse_text_kr": verse_text,
                            "translation": TRANSLATION,
                            "is_parallel": "true",
                            "note": f"parallel_from:{source_event_id}",
                        }
                    )
                    evidence_id += 1

    chronology_rows: List[Dict[str, str]] = []
    edge_id = 1

    event_ids = [event_id for event_id, _, _ in event_objects]
    for i in range(len(event_ids) - 1):
        frm = event_ids[i]
        to = event_ids[i + 1]
        basis = event_objects[i][1].start_ref
        chronology_rows.append(
            {
                "edge_id": f"EDG{edge_id:06d}",
                "from_event_id": frm,
                "to_event_id": to,
                "relation_type": "before",
                "basis_reference": basis,
                "track_id": "track_main",
            }
        )
        edge_id += 1

    exodus_related = [event_id for event_id, _cand, lane in event_objects if lane in {"exodus_wilderness", "conquest_settlement", "judges_period"}]
    gospel_related = [event_id for event_id, _cand, lane in event_objects if lane in {"life_of_jesus", "early_church"}]

    def add_track_edges(track_id: str, ids: List[str]) -> None:
        nonlocal edge_id
        for i in range(len(ids) - 1):
            frm = ids[i]
            to = ids[i + 1]
            chronology_rows.append(
                {
                    "edge_id": f"EDG{edge_id:06d}",
                    "from_event_id": frm,
                    "to_event_id": to,
                    "relation_type": "before",
                    "basis_reference": "성경 본문 흐름",
                    "track_id": track_id,
                }
            )
            edge_id += 1

    add_track_edges("track_exodus_early", exodus_related)
    add_track_edges("track_exodus_late", exodus_related)
    add_track_edges("track_gospel_harmony", gospel_related)

    track_rows = [
        {
            "track_id": "track_main",
            "topic": "기본 상대연대 축",
            "description": "정경 순서+본문 사건 흐름을 기준으로 한 기본 렌더링 트랙",
            "default_for_render": "true",
            "included_event_ids": "|".join(event_ids),
        },
        {
            "track_id": "track_exodus_early",
            "topic": "출애굽-정복 해석 A",
            "description": "출애굽-정복 구간을 상대연대 중심으로 빠르게 연결하는 보조 트랙",
            "default_for_render": "false",
            "included_event_ids": "|".join(exodus_related),
        },
        {
            "track_id": "track_exodus_late",
            "topic": "출애굽-정복 해석 B",
            "description": "출애굽-정복 구간의 대안 해석 표기를 위한 병행 트랙",
            "default_for_render": "false",
            "included_event_ids": "|".join(exodus_related),
        },
        {
            "track_id": "track_gospel_harmony",
            "topic": "복음서 병행 정렬",
            "description": "마태·마가·누가·요한 사건 제목 유사성을 이용한 병행 근거 트랙",
            "default_for_render": "false",
            "included_event_ids": "|".join(gospel_related),
        },
    ]

    # Validation
    events_by_id = {row["event_id"]: row for row in events_rows}
    evidence_by_event = defaultdict(int)
    for row in evidence_rows:
        eid = row["event_id"]
        if eid not in events_by_id:
            raise RuntimeError(f"evidence_verses.csv 무결성 오류: 알 수 없는 event_id {eid}")
        if not row["verse_text_kr"]:
            raise RuntimeError(f"evidence_verses.csv 본문 누락: {row['evidence_id']}")
        if row["translation"] != TRANSLATION:
            raise RuntimeError(f"translation 위반: {row['evidence_id']} -> {row['translation']}")
        evidence_by_event[eid] += 1

    missing_evidence = [eid for eid in events_by_id if evidence_by_event[eid] == 0]
    if missing_evidence:
        raise RuntimeError(f"근거 없는 사건 발견: {missing_evidence[:5]}")

    for row in events_rows:
        if not row["lane_tag"] or not row["sequence_index"]:
            raise RuntimeError(f"events.csv 필수 필드 누락: {row['event_id']}")

    edges_by_track: Dict[str, List[Tuple[str, str]]] = defaultdict(list)
    nodes_by_track: Dict[str, set] = defaultdict(set)
    for row in chronology_rows:
        track_id = row["track_id"]
        frm = row["from_event_id"]
        to = row["to_event_id"]
        edges_by_track[track_id].append((frm, to))
        nodes_by_track[track_id].add(frm)
        nodes_by_track[track_id].add(to)

    for track_id, nodes in nodes_by_track.items():
        if not topological_ok(nodes, edges_by_track[track_id]):
            raise RuntimeError(f"DAG 위반: {track_id}")

    # Write outputs
    write_csv(
        output_dir / "events.csv",
        events_rows,
        [
            "event_id",
            "testament",
            "book",
            "event_title",
            "event_summary",
            "lane_tag",
            "sequence_index",
            "track_id",
            "certainty_level",
        ],
    )

    write_csv(
        output_dir / "evidence_verses.csv",
        evidence_rows,
        [
            "evidence_id",
            "event_id",
            "evidence_tier",
            "reference",
            "verse_text_kr",
            "translation",
            "is_parallel",
            "note",
        ],
    )

    write_csv(
        output_dir / "chronology_edges.csv",
        chronology_rows,
        [
            "edge_id",
            "from_event_id",
            "to_event_id",
            "relation_type",
            "basis_reference",
            "track_id",
        ],
    )

    write_csv(
        output_dir / "interpretation_tracks.csv",
        track_rows,
        [
            "track_id",
            "topic",
            "description",
            "default_for_render",
            "included_event_ids",
        ],
    )

    notes_md = f"""# Research Notes

## 프로젝트 요약
- 정경 범위: 개신교 66권
- 번역: {TRANSLATION}
- 사건 추출 기준: 본문 내 표제(`<...>`) 기반 서사 단락
- 최종 사건 수: {len(events_rows)}
- 근거 구절 수(직접+병행): {len(evidence_rows)}
- 연대 간선 수: {len(chronology_rows)}

## 소스
- 원문 경로: `{source_dir}`
- 인코딩: `cp949`
- 파싱 규칙: `책약어장:절 본문`

## 처리 규칙
- 사건은 내러티브 중심 도서({len(NARRATIVE_BOOKS)}권)에서 추출.
- 사건별 근거는 해당 표제 구간의 모든 절을 포함.
- 복음서 동일/유사 표제는 병행근거(`evidence_tier=parallel`)로 확장.
- 상대연대는 `sequence_index` + DAG(`chronology_edges.csv`)로 모델링.

## 검증 결과
- 모든 사건은 최소 1개 근거 구절 보유: 통과
- 모든 근거 구절은 유효 `event_id`로 연결: 통과
- `translation=개역개정` 외 값: 0건
- 트랙별 DAG 순환 검사: 통과 (`track_main`, `track_exodus_early`, `track_exodus_late`, `track_gospel_harmony`)
- `sequence_index`/`lane_tag` 누락: 0건

## 해석 분기 메모
- `track_exodus_early` / `track_exodus_late`: 출애굽-정복 구간의 대안 표기용 병행 트랙
- `track_gospel_harmony`: 복음서 병행 전승을 인포그래픽에서 교차선으로 표현하기 위한 트랙
"""

    mapping_md = """# Infographic Mapping

## 메인 축
- `sequence_index`를 x축 기본 정렬값으로 사용.
- 기본 렌더링은 `track_main`.

## 레인 구성 (`lane_tag`)
- `primeval_history`: 창세기 1-11
- `patriarchal_era`: 창세기 12-50
- `exodus_wilderness`: 출애굽기/민수기/신명기
- `conquest_settlement`: 여호수아
- `judges_period`: 사사기/룻기
- `united_monarchy`: 사무엘상/사무엘하
- `monarchy_exile`: 열왕기상·하/역대상·하
- `exile_return`: 에스라/느헤미야/에스더/다니엘
- `prophetic_mission`: 요나
- `life_of_jesus`: 4복음서
- `early_church`: 사도행전

## 이벤트 카드 필수 필드
- 제목: `event_title`
- 요약: `event_summary`
- 근거: `evidence_verses.csv`에서 `event_id` 매칭 후 `reference + verse_text_kr`
- 확실성 배지: `certainty_level`

## 선/연결 규칙
- 기본 연결선: `chronology_edges.csv` + `track_id=track_main`
- 분기 연결선: `track_exodus_early`, `track_exodus_late`, `track_gospel_harmony`
- 관계 유형 기본값: `relation_type=before`

## 표기 권장
- 카드 하단에 최소 1개 `reference` 노출, 상세 모드에서 해당 사건 전 근거구절 확장.
- 병행근거(`is_parallel=true`)는 점선 또는 교차선으로 표시.
"""

    (output_dir / "research_notes.md").write_text(notes_md, encoding="utf-8")
    (output_dir / "infographic_mapping.md").write_text(mapping_md, encoding="utf-8")

    print(f"[done] source_dir={source_dir}")
    print(f"[done] events={len(events_rows)}")
    print(f"[done] evidence_rows={len(evidence_rows)}")
    print(f"[done] edges={len(chronology_rows)}")


if __name__ == "__main__":
    main()
