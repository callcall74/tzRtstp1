# RTSP 뷰어

ffmpeg로 RTSP 스트림을 MJPEG로 변환해 웹 브라우저에서 보여주는 사이트입니다.

## 실행

```bash
npm install
npm start
```

브라우저에서 http://localhost:3000 에 접속합니다.

## 카메라 설정

화면 상단에서 RTSP 주소를 입력해 카메라를 추가할 수 있습니다.
추가한 카메라는 `cameras.json`에 저장됩니다 (비밀번호가 포함되므로 git에는 올라가지 않습니다).
형식은 `cameras.example.json`을 참고하세요.

## ffmpeg

PATH에 `ffmpeg`가 있으면 그것을 사용하고, 없으면 `ffmpeg-static` 패키지의 ffmpeg를 사용합니다.
`FFMPEG_PATH` 환경 변수로 경로를 직접 지정할 수도 있습니다.
