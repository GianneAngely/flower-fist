# Flower Fist

Make a fist in front of your camera and a real bouquet appears in your hand, held by its stems.

A small computer-vision studio that runs entirely in the browser. Nothing is uploaded: the camera feed is processed on your device.

## Features

- **Hand tracking**: MediaPipe HandLandmarker detects a fist and anchors the bouquet to the grip, following its rotation.
- **Hand in front of the flowers**: a selfie segmentation mask keeps your fingers drawn over the stems.
- **Two-hand resize**: one hand holds, the other pinches or spreads to scale (1×–2.5×). Hold an open palm to lock the size, a peace sign to unlock.
- **12 bouquets** with their meaning in the language of flowers.
- **Magazine landing page**: one "issue" per bouquet.
- **Capture**: photo, video (with music), and a photo booth with print sizes and floral frames.
- **Filters and beauty**: live filter previews, natural skin smoothing and lip tints (FaceLandmarker).
- **Music**: a turntable playing 30-second Spotify previews.
- **Responsive**: desktop, iPad and phone layouts.

## Run locally

No build step. Serve the folder and open it:

```sh
python3 -m http.server 8000
# http://localhost:8000
```

Camera access needs `localhost` or HTTPS.

## Stack

Plain HTML, CSS and JavaScript modules · [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) · Canvas 2D · MediaRecorder · Web Audio

## Credits

See [CREDITS.md](CREDITS.md) for image and music sources.
