#!/usr/bin/env python3
"""Build web timeline JSON.

Modes:
- all_verses (default): parse all 66 text files and place every chapter on timeline.
- research: build from research CSV snapshot.
"""

from __future__ import annotations

import argparse
import csv
import glob
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

FILENAME_RE = re.compile(r"^([12])-(\d{2})(.+)\.txt$")
VERSE_RE = re.compile(r"^([^\d]+?)(\d+):(\d+)\s+(.*)$")
HEADING_RE = re.compile(r"^\s*<([^>]+)>\s*(.*)$")

TRANSLATION = "개역개정"
CERTAINTY_SET = {"high", "medium", "low", "disputed"}

LANE_DEFS = [
    ("primeval_history", "원역사", 1),
    ("patriarchal_era", "족장시대", 2),
    ("exodus_wilderness", "출애굽·광야", 3),
    ("conquest_settlement", "정복·정착", 4),
    ("judges_period", "사사시대", 5),
    ("united_monarchy", "통일왕국", 6),
    ("monarchy_exile", "분열왕국·포로", 7),
    ("wisdom_poetry", "시가·지혜", 8),
    ("prophetic_books", "예언서", 9),
    ("exile_return", "포로·귀환", 10),
    ("life_of_jesus", "예수 사역", 11),
    ("early_church", "초대교회", 12),
]

EXODUS_BOOKS = {"출애굽기", "레위기", "민수기", "신명기"}
JUDGES_BOOKS = {"사사기", "룻기"}
UNITED_MONARCHY_BOOKS = {"사무엘상", "사무엘하"}
MONARCHY_EXILE_BOOKS = {"열왕기상", "열왕기하", "역대상", "역대하"}
WISDOM_BOOKS = {"욥기", "시편", "잠언", "전도서", "아가"}
PROPHET_BOOKS = {
    "이사야",
    "예레미야",
    "예레미야애가",
    "에스겔",
    "다니엘",
    "호세아",
    "요엘",
    "아모스",
    "오바댜",
    "요나",
    "미가",
    "나훔",
    "하박국",
    "스바냐",
    "학개",
    "스가랴",
    "말라기",
}
EXILE_RETURN_BOOKS = {"에스라", "느헤미야", "에스더"}
GOSPEL_BOOKS = {"마태복음", "마가복음", "누가복음", "요한복음"}


def normalize_text(value: str) -> str:
    return unicodedata.normalize("NFC", value.strip())


def clean_heading_prefix(text: str) -> str:
    text = text.strip()
    while True:
        match = HEADING_RE.match(text)
        if not match:
            return text
        text = match.group(2).strip()


def truncate(text: str, max_len: int = 120) -> str:
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"


def lane_for(book_name: str, chapter: int) -> str:
    if book_name == "창세기":
        return "primeval_history" if chapter <= 11 else "patriarchal_era"
    if book_name in EXODUS_BOOKS:
        return "exodus_wilderness"
    if book_name == "여호수아":
        return "conquest_settlement"
    if book_name in JUDGES_BOOKS:
        return "judges_period"
    if book_name in UNITED_MONARCHY_BOOKS:
        return "united_monarchy"
    if book_name in MONARCHY_EXILE_BOOKS:
        return "monarchy_exile"
    if book_name in WISDOM_BOOKS:
        return "wisdom_poetry"
    if book_name in PROPHET_BOOKS:
        return "prophetic_books"
    if book_name in EXILE_RETURN_BOOKS:
        return "exile_return"
    if book_name in GOSPEL_BOOKS:
        return "life_of_jesus"
    return "early_church"


def discover_source_dir(explicit: str | None = None) -> Path:
    if explicit:
        path = Path(explicit).expanduser()
        if path.is_dir():
            return path
        raise FileNotFoundError(f"지정한 source_dir를 찾을 수 없습니다: {explicit}")

    fast_patterns = [
        ("/Users/daniel/Documents/*MacBook*2/원어연구/개역개정-pdf, txt/개역개정-text", False),
        ("/Users/daniel/Documents/*/원어연구/개역개정-pdf, txt/개역개정-text", False),
    ]
    slow_patterns = [
        ("/Users/daniel/Documents/**/개역개정-text", True),
        ("/Users/daniel/Library/CloudStorage/GoogleDrive-*/**/개역개정-pdf, txt/개역개정-text", True),
    ]

    for pattern, recursive in fast_patterns + slow_patterns:
        iterator = glob.iglob(pattern, recursive=recursive)
        for raw in iterator:
            path = Path(raw)
            if not path.is_dir():
                continue
            try:
                txt_count = sum(
                    1
                    for item in path.iterdir()
                    if item.suffix.lower() == ".txt" and FILENAME_RE.match(item.name)
                )
            except Exception:
                continue
            if txt_count >= 66:
                return path

    raise FileNotFoundError("개역개정-text 소스 폴더를 찾지 못했습니다. --source-dir로 지정하세요.")


def normalize_lanes(events: list[dict[str, object]]) -> list[dict[str, object]]:
    used_lanes = {str(e["lane_tag"]) for e in events}
    lanes: list[dict[str, object]] = []

    for lane_id, label, order in LANE_DEFS:
        if lane_id in used_lanes:
            lanes.append({"id": lane_id, "label": label, "order": order})

    return lanes


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def normalize_events(rows: list[dict[str, str]]) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    seen_ids: set[str] = set()

    for row in rows:
        event_id = row["event_id"].strip()
        if event_id in seen_ids:
            raise ValueError(f"중복 event_id: {event_id}")
        seen_ids.add(event_id)

        certainty = row["certainty_level"].strip()
        if certainty not in CERTAINTY_SET:
            certainty = "medium"

        events.append(
            {
                "event_id": event_id,
                "lane_tag": row["lane_tag"].strip(),
                "sequence_index": int(row["sequence_index"]),
                "book": row["book"].strip(),
                "event_title": row["event_title"].strip(),
                "event_summary": row["event_summary"].strip(),
                "certainty_level": certainty,
            }
        )

    events.sort(key=lambda x: int(x["sequence_index"]))
    return events


def normalize_evidence(
    rows: list[dict[str, str]], event_ids: set[str]
) -> tuple[dict[str, dict[str, list[dict[str, str]]]], str, int]:
    evidence_by_event: dict[str, dict[str, list[dict[str, str]]]] = {
        eid: {"direct": [], "parallel": []} for eid in event_ids
    }
    translation_set: set[str] = set()

    for row in rows:
        event_id = row["event_id"].strip()
        if event_id not in evidence_by_event:
            raise ValueError(f"존재하지 않는 event_id 참조: {event_id}")

        tier = row["evidence_tier"].strip().lower()
        translation = row["translation"].strip()
        translation_set.add(translation)

        base = {
            "reference": row["reference"].strip(),
            "verse_text_kr": row["verse_text_kr"].strip(),
        }

        if tier == "parallel":
            base["note"] = row["note"].strip()
            evidence_by_event[event_id]["parallel"].append(base)
        else:
            evidence_by_event[event_id]["direct"].append(base)

    if len(translation_set) != 1:
        raise ValueError(f"translation 값이 단일하지 않음: {sorted(translation_set)}")

    translation = next(iter(translation_set))
    total_evidence = sum(
        len(v["direct"]) + len(v["parallel"]) for v in evidence_by_event.values()
    )

    for event_id, bucket in evidence_by_event.items():
        if not bucket["direct"]:
            raise ValueError(f"direct 근거 누락: {event_id}")

    return evidence_by_event, translation, total_evidence


def normalize_edges(
    rows: list[dict[str, str]], event_ids: set[str]
) -> dict[str, list[dict[str, str]]]:
    by_track: dict[str, list[dict[str, str]]] = defaultdict(list)

    for row in rows:
        frm = row["from_event_id"].strip()
        to = row["to_event_id"].strip()
        if frm not in event_ids or to not in event_ids:
            raise ValueError(f"edge가 알 수 없는 event를 참조: {frm}->{to}")

        relation = row["relation_type"].strip()
        if relation != "before":
            relation = "before"

        by_track[row["track_id"].strip()].append(
            {
                "from_event_id": frm,
                "to_event_id": to,
                "relation_type": relation,
            }
        )

    return dict(by_track)


def build_from_research(research_dir: Path) -> dict[str, object]:
    events_rows = read_csv(research_dir / "events.csv")
    evidence_rows = read_csv(research_dir / "evidence_verses.csv")
    edges_rows = read_csv(research_dir / "chronology_edges.csv")

    events = normalize_events(events_rows)
    event_ids = {str(e["event_id"]) for e in events}
    evidence_by_event, translation, total_evidence = normalize_evidence(evidence_rows, event_ids)
    edges_by_track = normalize_edges(edges_rows, event_ids)
    lanes = normalize_lanes(events)

    return {
        "meta": {
            "translation": translation,
            "totalEvents": len(events),
            "totalEvidence": total_evidence,
            "mode": "research",
        },
        "lanes": lanes,
        "events": events,
        "evidenceByEvent": evidence_by_event,
        "edgesByTrack": edges_by_track,
    }


def build_from_all_verses(source_dir: Path) -> dict[str, object]:
    files: list[tuple[int, int, str, Path]] = []

    for path in source_dir.iterdir():
        if path.suffix.lower() != ".txt":
            continue
        m = FILENAME_RE.match(path.name)
        if not m:
            continue
        testament_mark = int(m.group(1))
        order = int(m.group(2))
        book_name = normalize_text(m.group(3))
        files.append((testament_mark, order, book_name, path))

    files.sort(key=lambda x: (x[0], x[1]))
    if len(files) < 66:
        raise ValueError(f"66권 파싱 실패: {len(files)}권")

    chapters: list[dict[str, object]] = []
    verses_by_chapter: dict[str, list[dict[str, object]]] = {}
    edges: list[dict[str, str]] = []

    seq = 0
    prev_chapter_id: str | None = None
    total_verses = 0

    def flush_chapter(book_name: str, chapter: int, verses: list[dict[str, object]]) -> None:
        nonlocal seq, prev_chapter_id
        if not verses:
            return

        seq += 1
        chapter_id = f"CHP{seq:04d}"
        event_title = f"{book_name} {chapter}장"
        event_summary = truncate(str(verses[0]["verse_text_kr"]), 120)

        chapters.append(
            {
                "chapter_id": chapter_id,
                "lane_tag": lane_for(book_name, chapter),
                "sequence_index": seq,
                "book": book_name,
                "chapter": chapter,
                "event_title": event_title,
                "event_summary": event_summary,
                "verse_count": len(verses),
                "certainty_level": "high",
            }
        )
        verses_by_chapter[chapter_id] = verses

        if prev_chapter_id is not None:
            edges.append(
                {
                    "from_chapter_id": prev_chapter_id,
                    "to_chapter_id": chapter_id,
                    "relation_type": "before",
                }
            )
        prev_chapter_id = chapter_id

    for _tm, _ord, book_name, file_path in files:
        current_chapter: int | None = None
        current_verses: list[dict[str, object]] = []

        with file_path.open("r", encoding="cp949", errors="strict") as handle:
            for raw in handle:
                line = normalize_text(raw)
                if not line:
                    continue

                m = VERSE_RE.match(line)
                if not m:
                    continue

                chapter = int(m.group(2))
                verse = int(m.group(3))
                text = normalize_text(m.group(4))
                cleaned = clean_heading_prefix(text)
                verse_text = cleaned if cleaned else text
                reference = f"{book_name} {chapter}:{verse}"

                if current_chapter is None:
                    current_chapter = chapter
                elif chapter != current_chapter:
                    flush_chapter(book_name, current_chapter, current_verses)
                    current_chapter = chapter
                    current_verses = []

                current_verses.append(
                    {
                        "verse_no": verse,
                        "reference": reference,
                        "verse_text_kr": verse_text,
                    }
                )
                total_verses += 1

        if current_chapter is not None:
            flush_chapter(book_name, current_chapter, current_verses)

    lanes = normalize_lanes(chapters)

    return {
        "meta": {
            "translation": TRANSLATION,
            "mode": "all_verses",
            "granularity": "chapter",
            "totalChapters": len(chapters),
            "totalVerses": total_verses,
        },
        "lanes": lanes,
        "chapters": chapters,
        "versesByChapter": verses_by_chapter,
        "edgesByTrack": {"track_main": edges},
    }


def summarize_build_meta(timeline_data: dict[str, object]) -> list[str]:
    meta = timeline_data.get("meta")
    if not isinstance(meta, dict):
        return []

    summary: list[str] = []
    if "totalEvents" in meta:
        summary.append(f"totalEvents={meta['totalEvents']}")
    if "totalEvidence" in meta:
        summary.append(f"totalEvidence={meta['totalEvidence']}")
    if "totalChapters" in meta:
        summary.append(f"totalChapters={meta['totalChapters']}")
    if "totalVerses" in meta:
        summary.append(f"totalVerses={meta['totalVerses']}")
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build web timeline JSON")
    parser.add_argument(
        "--mode",
        choices=["all_verses", "research"],
        default="all_verses",
        help="Build mode (default: all_verses)",
    )
    parser.add_argument(
        "--source-dir",
        default=None,
        help="Path to 개역개정-text directory (used in all_verses mode)",
    )
    parser.add_argument(
        "--research-dir",
        default="research",
        help="Path to research directory containing CSV files (used in research mode)",
    )
    parser.add_argument(
        "--output",
        default="web/data/timeline.json",
        help="Output JSON path",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Write pretty-printed JSON",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_path = Path(args.output)

    if args.mode == "research":
        research_dir = Path(args.research_dir)
        if not research_dir.exists():
            raise FileNotFoundError(f"research 디렉토리를 찾을 수 없습니다: {research_dir}")
        timeline_data = build_from_research(research_dir)
        source_hint = str(research_dir)
    else:
        source_dir = discover_source_dir(args.source_dir)
        timeline_data = build_from_all_verses(source_dir)
        source_hint = str(source_dir)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if args.pretty:
        payload = json.dumps(timeline_data, ensure_ascii=False, indent=2)
    else:
        payload = json.dumps(timeline_data, ensure_ascii=False, separators=(",", ":"))
    output_path.write_text(payload, encoding="utf-8")

    print(f"[done] mode={args.mode}")
    print(f"[done] source={source_hint}")
    print(f"[done] output={output_path}")
    for line in summarize_build_meta(timeline_data):
        print(f"[done] {line}")
    print(f"[done] lanes={len(timeline_data['lanes'])}")


if __name__ == "__main__":
    main()
