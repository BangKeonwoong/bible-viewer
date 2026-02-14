# 성경 타임라인 웹 도식화 (Vertical Scroll)

정적 HTML/CSS/JS 기반의 **세로 스크롤 타임라인**입니다.
가운데 수직 축을 기준으로 좌우 지그재그 카드가 배치되고, 스크롤 구간만 렌더링하는 가상화(virtualization)로 대용량 데이터(all_verses)를 처리합니다.

## 구성 파일
- `index.html`: 상단 컨트롤, 세로 타임라인 뷰포트, 우측 상세 패널
- `styles.css`: 수직축/카드 지그재그 레이아웃, 모바일 단일열, 범례/툴팁 스타일
- `app.js`: 데이터 정규화, 필터/검색, 가상화 렌더러, hover/tap 상호작용
- `data/timeline.json`: 웹 렌더링용 정규화 데이터

## 렌더링 구조
- 상단 컨트롤 유지: 레인 탭(`전체보기` 포함), 검색, 책 필터, 트랙 토글, 병행근거 토글
- 메인 타임라인:
  - `timeline-scroll`: 세로 스크롤 컨테이너
  - `timeline-axis`: 중앙 수직축
  - `timeline-virtual`: 가상화 카드 레이어(보이는 카드만 DOM 렌더)
- 상세 패널:
  - 선택 장(`selectedChapterId`) 기준 Direct/Parallel 근거 표시
  - 확장 상태(`expandedChapterId`)는 별도 관리, 동시에 1개만 확장

## 데이터 스키마
현재 렌더러 기준 기본 스키마는 아래입니다.

```json
{
  "meta": {
    "translation": "개역개정",
    "mode": "all_verses",
    "granularity": "chapter",
    "totalChapters": 1189,
    "totalVerses": 31077
  },
  "lanes": [
    { "id": "primeval_history", "label": "원역사", "order": 1 }
  ],
  "chapters": [
    {
      "chapter_id": "GEN_001",
      "lane_tag": "primeval_history",
      "sequence_index": 1,
      "book": "창세기",
      "chapter": 1,
      "event_title": "창세기 1장",
      "event_summary": "요약",
      "verse_count": 31,
      "certainty_level": "high"
    }
  ],
  "versesByChapter": {
    "GEN_001": [
      {
        "verse_no": 1,
        "reference": "창세기 1:1",
        "verse_text_kr": "태초에 하나님이..."
      }
    ]
  },
  "edgesByTrack": {
    "track_main": [
      { "from_chapter_id": "GEN_001", "to_chapter_id": "GEN_002", "relation_type": "before" }
    ]
  }
}
```

호환성:
- 기존 `events + evidenceByEvent` 포맷도 앱에서 자동 변환해 렌더링합니다.

## all_verses 장 단위 기준
`all_verses`는 **장(chapter) 단위 카드**를 기준으로 사용합니다.
- `chapters`: 장 메타(카드 단위)
- `versesByChapter[chapter_id]`: 해당 장의 전체 구절
- 검색은 `event_title + event_summary + reference` 텍스트를 대상으로 동작

## 필터/상호작용
- 레인: `전체보기` 또는 단일 레인
- 책 필터: 전체/개별 책
- 검색: 제목/요약/구절 참조 텍스트
  - 검색 결과가 있으면 첫 결과를 자동 선택 + 스크롤 이동
- 데스크톱: hover 시 툴팁 + 상세 패널 동기화
- 모바일: tap 시 선택 고정(pinned) + 툴팁/상세 패널 동기화

## 가상화(virtualization)
- 카드 높이 모델(기본/확장)과 스크롤 오프셋을 사용해 렌더링 윈도우 계산
- overscan 구간을 포함한 카드만 DOM 생성
- 수만 건 카드에서도 스크롤 성능과 메모리 사용량을 안정적으로 유지

## 실행
```bash
cd web
python3 -m http.server 8080
```
브라우저에서 `http://localhost:8080` 접속.

## 검증 지표(Validation Metrics)
빌드 산출물 검증 시 아래 항목을 확인합니다.
- `meta.mode === "all_verses"`
- `meta.granularity === "chapter"`
- `meta.totalVerses === 31077`
- `chapters.length === meta.totalChapters`
- `Object.keys(versesByChapter).length === meta.totalChapters`
- `sum(versesByChapter[*].length) === meta.totalVerses`
- 모든 chapter가 `versesByChapter[chapter_id]` 1개 이상 보유
- 고아 edge 수(존재하지 않는 `chapter_id` 참조) 0

예시 점검 명령:
```bash
node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync('web/data/timeline.json','utf8'));const chapters=d.chapters||[];const verses=d.versesByChapter||{};const ids=new Set(chapters.map(c=>c.chapter_id));let total=0,directOwners=0;for(const [id,list] of Object.entries(verses)){const arr=Array.isArray(list)?list:[...(list.direct||[]),...(list.parallel||[])];total+=arr.length;if(arr.some(v=>(v.evidence_tier||'direct')!=='parallel'))directOwners++;}let orphan=0;for(const edges of Object.values(d.edgesByTrack||{})){for(const e of edges||[]){const from=e.from_chapter_id||e.from_event_id;const to=e.to_chapter_id||e.to_event_id;if((from&&!ids.has(from))||(to&&!ids.has(to)))orphan++;}}console.log({chapters:chapters.length,verseBuckets:Object.keys(verses).length,totalVerses:total,directOwners,orphanEdges:orphan});"
```
