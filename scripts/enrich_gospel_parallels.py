#!/usr/bin/env python3
from __future__ import annotations

import csv
import re
from pathlib import Path

BASE = Path('/Users/daniel/Documents/성경 타임라인/research')
EVENTS = BASE / 'events.csv'
EVIDENCE = BASE / 'evidence_verses.csv'

GOSPELS = {'마태복음', '마가복음', '누가복음', '요한복음'}
STOPWORDS = {'예수', '예수께서', '예수님', '그가', '그의', '하나님', '말씀', '제자들'}


def tokens(title: str) -> set[str]:
    cleaned = re.sub(r'[^가-힣A-Za-z0-9 ]+', ' ', title)
    return {t for t in cleaned.split() if len(t) >= 2 and t not in STOPWORDS}


def score(a: str, b: str) -> float:
    ta = tokens(a)
    tb = tokens(b)
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    union = len(ta | tb)
    return inter / union if union else 0.0


def main() -> None:
    with EVENTS.open(encoding='utf-8-sig') as f:
        events = list(csv.DictReader(f))

    with EVIDENCE.open(encoding='utf-8-sig') as f:
        evidence = list(csv.DictReader(f))

    gospel_events = [e for e in events if e['book'] in GOSPELS]
    evidence_by_event: dict[str, list[dict[str, str]]] = {}
    max_id = 0
    for row in evidence:
        max_id = max(max_id, int(row['evidence_id'][3:]))
        if row['evidence_tier'] == 'direct':
            evidence_by_event.setdefault(row['event_id'], []).append(row)

    existing_parallel_keys = {
        (row['event_id'], row['note'])
        for row in evidence
        if row['evidence_tier'] == 'parallel' and row['note']
    }

    additions: list[dict[str, str]] = []

    for target in gospel_events:
        best_by_book: dict[str, tuple[float, dict[str, str]]] = {}
        for source in gospel_events:
            if source['event_id'] == target['event_id']:
                continue
            if source['book'] == target['book']:
                continue

            s = score(target['event_title'], source['event_title'])
            if s < 0.35:
                continue

            prev = best_by_book.get(source['book'])
            if prev is None or s > prev[0]:
                best_by_book[source['book']] = (s, source)

        for s, source in sorted(best_by_book.values(), key=lambda x: x[0], reverse=True)[:3]:
            note = f"parallel_from:{source['event_id']};score={s:.2f}"
            key = (target['event_id'], note)
            if key in existing_parallel_keys:
                continue
            src_rows = evidence_by_event.get(source['event_id'], [])[:8]
            for src in src_rows:
                max_id += 1
                additions.append(
                    {
                        'evidence_id': f'EVD{max_id:07d}',
                        'event_id': target['event_id'],
                        'evidence_tier': 'parallel',
                        'reference': src['reference'],
                        'verse_text_kr': src['verse_text_kr'],
                        'translation': src['translation'],
                        'is_parallel': 'true',
                        'note': note,
                    }
                )

    if additions:
        evidence.extend(additions)
        evidence.sort(key=lambda r: int(r['evidence_id'][3:]))
        with EVIDENCE.open('w', encoding='utf-8-sig', newline='') as f:
            writer = csv.DictWriter(
                f,
                fieldnames=[
                    'evidence_id',
                    'event_id',
                    'evidence_tier',
                    'reference',
                    'verse_text_kr',
                    'translation',
                    'is_parallel',
                    'note',
                ],
            )
            writer.writeheader()
            writer.writerows(evidence)

    print(f'added_parallel_rows={len(additions)}')


if __name__ == '__main__':
    main()
