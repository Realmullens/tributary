# Tributary mobile (Expo)

A native shell around the Tributary web studio. The web room already does the heavy lifting —
WebRTC call, **local MediaRecorder recording on the phone**, chunked upload, crash recovery —
so the app's job is to make that installable: camera/mic permissions, keep-awake while
recording/uploading, and a remembered server address. This is also the "phone as extra camera"
path: join the session from your phone and it becomes another fully recorded participant.

## Requirements

- Your Tributary server must be reachable over **HTTPS** (camera/mic need a secure context
  inside the WebView). See `../docs/DEPLOYMENT.md` — Tailscale Funnel is the fastest path.
- iOS 15+ / recent Android.

## Develop

```bash
cd mobile
npm install
npx expo start        # scan the QR with Expo Go (iOS/Android)
```

Enter your server address (e.g. `studio.example.com`) or paste a join link. In Expo Go the
WebView inherits Expo Go's camera/mic permissions.

## Build installable apps

```bash
npx expo prebuild                # generates ios/ + android/
npx expo run:ios                 # or run:android — needs Xcode / Android Studio
# or cloud builds without local toolchains:
npx eas build --platform all     # Expo Application Services
```

The camera/microphone permission strings and Android permissions are already configured in
`app.json`.

## Known limitations

- iOS WebView (WKWebView) records MP4/H.264 via MediaRecorder (Safari engine); Android records
  WebM like desktop Chrome. Both process fine server-side.
- Keep the app foregrounded while uploading — iOS suspends background WebViews. The recovery
  flow picks up unfinished uploads on next launch, same as desktop.
- Full native capture (expo-camera recording + background upload task) is the planned next
  step if WebView capture proves limiting on older devices.
