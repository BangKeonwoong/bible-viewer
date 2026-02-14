# Research Notes

## 프로젝트 요약
- 정경 범위: 개신교 66권
- 번역: 개역개정
- 사건 추출 기준: 본문 내 표제(`<...>`) 기반 서사 단락
- 최종 사건 수: 320
- 근거 구절 수(직접+병행): 4030
- 연대 간선 수: 587

## 소스
- 원문 경로: `/Users/daniel/Documents/문서 - Bang의 MacBook M3Pro 2/원어연구/개역개정-pdf, txt/개역개정-text`
- 인코딩: `cp949`
- 파싱 규칙: `책약어장:절 본문`

## 처리 규칙
- 사건은 내러티브 중심 도서(23권)에서 추출.
- 사건별 근거는 해당 표제 구간의 모든 절을 포함.
- 복음서 유사 사건 매칭을 통해 병행근거(`evidence_tier=parallel`)를 추가 확장.
- 상대연대는 `sequence_index` + DAG(`chronology_edges.csv`)로 모델링.

## 검증 결과
- 모든 사건은 최소 1개 근거 구절 보유: 통과
- 모든 근거 구절은 유효 `event_id`로 연결: 통과
- `translation=개역개정` 외 값: 0건
- 병행근거(`is_parallel=true`): 135건
- 트랙별 DAG 순환 검사: 통과 (`track_main`, `track_exodus_early`, `track_exodus_late`, `track_gospel_harmony`)
- `sequence_index`/`lane_tag` 누락: 0건

## 해석 분기 메모
- `track_exodus_early` / `track_exodus_late`: 출애굽-정복 구간의 대안 표기용 병행 트랙
- `track_gospel_harmony`: 복음서 병행 전승을 인포그래픽에서 교차선으로 표현하기 위한 트랙
