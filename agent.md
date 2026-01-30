# 성경 비교 뷰어 구현 전략 (AGENT)

## 목표
- `역본` 폴더와 `성경 직역 정보.csv`의 마지막 열(직역)을 이용해 성경 비교 뷰어를 구성한다.
- **디자인 개선**: 세련되고 간결한 UI, 모바일 반응형 최적화.
- 두 역본 + 직역 열을 나란히 보여주고, 장 단위로 읽기 좋게 비교할 수 있게 한다.

## 데이터 전략
1) **정규화 인덱스 생성**
- `scripts/build_index.py`가 `data/index.json`을 생성한다.
- BHS 폴더의 영문 책 이름을 기준(bookId)으로 사용한다.
- NKRV 폴더의 번호-한글 책 이름으로 한글명과 순서를 매칭한다.
- KNT 폴더의 한글 책 이름은 NKRV 한글명과 매칭해 영문 bookId로 연결한다.
- 장 파일명은 숫자 정렬(예: 1, 2, …, 100)로 정렬한다.

2) **CSV 직역 매핑**
- CSV는 `;` 구분이며 마지막 열이 직역이다.
- CSV의 책 이름은 `Genesis`, `1_Samuel`, `Song_of_songs`처럼 언더스코어 표기를 사용한다.
- 뷰어에서는 `bookId`(예: `1 Samuel`)를 `1_Samuel`로 변환해 매칭한다.
- 특수 케이스: `Song of Solomon` → `Song_of_songs`.

3) **절 파싱 규칙**
- NKRV: `1. 내용` 형태를 파싱.
- BHS: `1 내용` 형태를 파싱 (히브리어 RTL 지원).
- KNT: `- 1: 내용` 형태를 파싱.
- 절 번호 기준으로 세 열(역본/역본/직역)을 정렬해 렌더링.

## UI/UX 전략 (Redesign)
- **Design Language**: Modern Minimalist. 종이 질감보다는 깔끔한 타이포그래피와 여백 중심의 레이아웃.
- **Typography**: 가독성 높은 세리프(본문)와 산세리프(UI) 조화.
- **Color Palette**: 눈이 편안한 웜 그레이/크림 톤 배경 + 절제된 포인트 컬러.
- **Responsive**:
    - **Desktop**: 3열 비교 뷰 (기존 유지하되 레이아웃 개선).
    - **Mobile**: 화면 폭에 따라 유동적인 레이아웃. 3열이 좁을 경우 수직 스택 또는 탭/슬라이드 방식 고려. 툴바/컨트롤의 접근성 향상 (하단 배치 등).
- **Interactions**: 부드러운 트랜지션, 직관적인 툴팁.

## 단계별 실행
1) 인덱스 생성 (완료)
- `python3 scripts/build_index.py`

2) 디자인 개편 (진행 중)
- HTML 구조 재설계 (Semantic HTML, Mobile-first structure).
- CSS 전면 리팩토링 (CSS Variables, Flex/Grid View).
- 반응형 미디어 쿼리 적용.

3) 로컬 서버 실행
- `python3 -m http.server 8000`
- 브라우저에서 `http://localhost:8000` 접속

## 협업(collab) 운영 계획
- **Coordinator**: 전체 일정/우선순위 관리.
- **Designer**: UI/UX 리뉴얼 주도.
- **Developer**: 프론트엔드 구현 및 최적화.

