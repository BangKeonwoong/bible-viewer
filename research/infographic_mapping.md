# Infographic Mapping

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
