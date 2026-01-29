#!/usr/bin/env python3
from pathlib import Path
import json
import re

ROOT = Path('.')
VERSIONS_DIR = ROOT / '역본'

TRANSLATIONS = {
    'BHS': {
        'label': 'BHS',
        'language': 'he',
        'dir': '역본/BHS',
        'direction': 'rtl',
    },
    'KNT': {
        'label': 'KNT (새한글성경 정리)',
        'language': 'ko',
        'dir': '역본/KNT',
        'direction': 'ltr',
    },
    'NKRV': {
        'label': 'NKRV (개역개정)',
        'language': 'ko',
        'dir': '역본/NKRV',
        'direction': 'ltr',
    },
}


def list_dirs(path: Path):
    return [p for p in path.iterdir() if p.is_dir()]


def list_md_files(path: Path):
    files = [p for p in path.iterdir() if p.is_file() and p.suffix.lower() == '.md']
    def sort_key(p: Path):
        try:
            return int(p.stem)
        except ValueError:
            return 10**9
    files.sort(key=sort_key)
    return [p.name for p in files]


# Parse BHS directories for English names and order
bhs_dirs = list_dirs(VERSIONS_DIR / 'BHS')
order_to_en = {}
for d in bhs_dirs:
    if d.name == '_cache':
        continue
    m = re.match(r'^(\d+)\s+(.+)$', d.name)
    if not m:
        continue
    order = int(m.group(1))
    name_en = m.group(2).strip()
    order_to_en[order] = name_en

# Parse NKRV directories for Korean names and order
nkrv_dirs = list_dirs(VERSIONS_DIR / 'NKRV')
order_to_ko = {}
ko_to_order = {}
for d in nkrv_dirs:
    m = re.match(r'^(\d+)-(.+)$', d.name)
    if not m:
        continue
    order = int(m.group(1))
    name_ko = m.group(2).strip()
    order_to_ko[order] = name_ko
    ko_to_order[name_ko] = order

# Build canonical book list
books = []
for order in sorted(order_to_en.keys()):
    name_en = order_to_en.get(order, f'Book {order}')
    name_ko = order_to_ko.get(order, '')
    books.append({
        'id': name_en,
        'order': order,
        'name_en': name_en,
        'name_ko': name_ko,
    })

# Build translation mappings
translations = {}
for key, meta in TRANSLATIONS.items():
    base = VERSIONS_DIR / key
    book_dirs = list_dirs(base)
    book_dir_map = {}
    chapters_map = {}

    for d in book_dirs:
        if key == 'BHS':
            if d.name == '_cache':
                continue
            m = re.match(r'^(\d+)\s+(.+)$', d.name)
            if not m:
                continue
            order = int(m.group(1))
            book_id = order_to_en.get(order)
        elif key == 'NKRV':
            m = re.match(r'^(\d+)-(.+)$', d.name)
            if not m:
                continue
            order = int(m.group(1))
            book_id = order_to_en.get(order)
        else:  # KNT
            name_ko = d.name
            order = ko_to_order.get(name_ko)
            book_id = order_to_en.get(order) if order else None
        if not book_id:
            continue
        book_dir_map[book_id] = d.name
        chapters_map[book_id] = list_md_files(d)

    translations[key] = {
        **meta,
        'bookDirs': book_dir_map,
        'chapterFiles': chapters_map,
    }

# Compute availability per book
availability = {}
for book in books:
    book_id = book['id']
    availability[book_id] = [t for t in translations.keys() if book_id in translations[t]['bookDirs']]

index = {
    'books': books,
    'translations': translations,
    'availability': availability,
}

out_dir = ROOT / 'data'
out_dir.mkdir(exist_ok=True)
with open(out_dir / 'index.json', 'w', encoding='utf-8') as f:
    json.dump(index, f, ensure_ascii=False, indent=2)

print('Wrote data/index.json')
