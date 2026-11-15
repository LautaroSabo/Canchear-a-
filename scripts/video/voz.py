# Genera la voz del video (una pista por frase) con la voz es_AR-daniela de Piper (pip install piper-tts).
# Uso: python3 scripts/video/voz.py <carpeta-del-modelo> <carpeta-salida>
# Deja <salida>/voz/*.wav y <salida>/duraciones.json (lo lee el spec para esperar a que termine cada frase).
import json, os, sys, wave
from piper import PiperVoice, SynthesisConfig

modelo, salida = sys.argv[1], sys.argv[2]
n = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'narracion.json')))
voz = PiperVoice.load(f'{modelo}/es_AR-daniela-high.onnx', config_path=f'{modelo}/es_AR-daniela-high.onnx.json')
cfg = SynthesisConfig(length_scale=1.0)
os.makedirs(f'{salida}/voz', exist_ok=True)


def decir(nombre, texto):
    ruta = f'{salida}/voz/{nombre}.wav'
    with wave.open(ruta, 'wb') as w:
        voz.synthesize_wav(texto, w, syn_config=cfg)
    with wave.open(ruta) as w:
        return w.getnframes() / w.getframerate()


d = {
    'intro': decir('intro', n['intro']),
    'cierre': decir('cierre', n['cierre']),
    'pasos': [decir(f'paso{i}', t) for i, t in enumerate(n['pasos'])],
}
json.dump(d, open(f'{salida}/duraciones.json', 'w'), indent=2)
print(json.dumps(d, indent=2))
