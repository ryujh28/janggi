# 장기 (브라우저 앱)

나에게 맞는 AI와 두면서 실력을 키우는 장기입니다. 휴대폰 브라우저에서 열어 홈 화면에 추가하면 앱처럼 쓸 수 있습니다. AI는 기기 안에서 돌아가므로 서버가 필요 없고, 한 번 연 뒤에는 오프라인으로도 둘 수 있습니다.

맥 버전(`../Janggi`)과 규칙, 급수, 외통 문제, 복기 해설이 같습니다. 전적은 기기마다 따로 저장됩니다.

## 올리기

GitHub에서 공개 저장소 `janggi`를 만든 뒤 이 폴더를 올리고, 저장소의 Settings → Pages에서 `main` 브랜치의 루트를 선택합니다.

```bash
cd ~/Desktop/ryujh28_codes/Janggi_Mobile
git init -b main
git add .
git commit -m "장기 브라우저 앱"
git remote add origin https://github.com/ryujh28/janggi.git
git push -u origin main
```

주소는 `https://ryujh28.github.io/janggi/`입니다.

## 휴대폰에 설치

- iPhone: Safari로 주소를 열고 공유 버튼에서 `홈 화면에 추가`를 누릅니다.
- Android: Chrome으로 주소를 열고 메뉴에서 `홈 화면에 추가`를 누릅니다.

## 고친 뒤 올릴 때

`sw.js` 맨 위의 `VERSION` 값을 바꿔야 휴대폰에 새 버전이 받아집니다.

## 구조

| 경로 | 내용 |
|---|---|
| `index.html`, `style.css`, `board.js`, `sound.js`, `app.js`, `study.js` | 화면 |
| `core/rules.js` | 규칙 판정 연결 |
| `core/engine.js` | 엔진 연결, 급수별 수 선택 |
| `core/review.js`, `core/commentary.js`, `core/intent.js` | 복기 분석, 해설, 수의 의도 |
| `core/store.js` | 브라우저 저장소 |
| `core/api.js` | 화면에서 부르는 게임 기능 |
| `sw.js` | 오프라인 실행과 엔진용 격리 환경 |
| `vendor/` | Fairy-Stockfish, ffish의 WebAssembly 빌드 |
| `data/` | 급수 설정, 외통 문제 |

## 라이선스

GPLv3입니다. 전문은 `LICENSE.txt`에 있습니다.

- [Fairy-Stockfish](https://github.com/fairy-stockfish/Fairy-Stockfish), [fairy-stockfish.wasm](https://github.com/fairy-stockfish/fairy-stockfish.wasm), ffish.js, [장기 신경망](https://github.com/fairy-stockfish/Fairy-Stockfish-NNUE): GPLv3
- 말 글자 글꼴 Yuji Boku, Yuji Syuku: SIL Open Font License 1.1
