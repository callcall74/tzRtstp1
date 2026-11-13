# RTSP 뷰어

ffmpeg로 RTSP 스트림을 MJPEG로 변환해 웹 브라우저에서 보여주는 사이트입니다.

## 실행

```bash
npm install
npm start
```

브라우저에서 http://localhost:3000 에 접속합니다.

## 로그인

처음 실행하면 로그인 비밀번호가 자동으로 만들어져 `config.json`에 저장되고 콘솔에도 출력됩니다.
비밀번호를 바꾸려면 `config.json`의 `password`를 수정해 저장하세요. 서버 재시작 없이 바로 적용되며 기존 로그인은 모두 풀립니다.
`ADMIN_PASSWORD` 환경 변수로 지정할 수도 있습니다.

## 시청 시간 제한

네트워크 사용량을 줄이기 위해 한 번 연결하면 30초 후 자동으로 끊깁니다 (서버에서 전송 중단).
화면의 "다시 보기" 버튼을 누르면 다시 30초 동안 볼 수 있습니다.
`config.json`에 `"viewLimitSec": 60`처럼 넣고 저장하면 바로 적용됩니다 (`0`이면 제한 없음). 보고 있던 화면은 다음 연결부터 적용됩니다.

## 외부에서 접속 (Cloudflare Tunnel)

[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)를 설치한 뒤,
서버를 켠 상태에서 다른 터미널에서 실행합니다.

```bash
npm run tunnel
```

출력되는 `https://xxxx.trycloudflare.com` 주소로 어디서든 접속할 수 있습니다.
이 주소는 실행할 때마다 바뀌며, PC가 켜져 있고 서버와 터널이 모두 실행 중이어야 합니다.

## 카메라 설정

화면 상단에서 RTSP 주소를 입력해 카메라를 추가할 수 있습니다.
추가한 카메라는 `cameras.json`에 저장됩니다 (비밀번호가 포함되므로 git에는 올라가지 않습니다).
형식은 `cameras.example.json`을 참고하세요.

## ffmpeg

PATH에 `ffmpeg`가 있으면 그것을 사용하고, 없으면 `ffmpeg-static` 패키지의 ffmpeg를 사용합니다.
`FFMPEG_PATH` 환경 변수로 경로를 직접 지정할 수도 있습니다.
