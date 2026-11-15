# Video de venta

Graba una reserva completa (celular del jugador y panel del club) y la arma con textos y voz.

Necesita: Postgres de test (`DATABASE_URL`), ffmpeg, `pip install piper-tts` y la voz
`vits-piper-es_AR-daniela-high` (release `tts-models` de k2-fsa/sherpa-onnx en GitHub).

```bash
SALIDA=/ruta/salida
python3 scripts/video/voz.py /ruta/vits-piper-es_AR-daniela-high $SALIDA   # voz (opcional)
cd apps/web && VIDEO_DIR=$SALIDA npx playwright test video-demo --trace off && cd ../..
python3 scripts/video/armar.py $SALIDA   # deja $SALIDA/cancheria-demo.mp4
```

Lo que dice la voz está en `narracion.json` (escrito como se pronuncia: "guásap", "cu erre").
