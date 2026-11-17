# Versión vertical (1080x1920, Reels e historias) del video de venta, con las mismas grabaciones
# y la misma voz que armar.py. Muestra el celular a pantalla completa y salta al panel del club
# en los dos momentos en que cambia: cuando aparece el turno y cuando se confirma.
# Uso: python3 scripts/video/armar_vertical.py <carpeta-de-VIDEO_DIR>  -> cancheria-vertical.mp4
import glob, json, os, subprocess, sys

os.chdir(sys.argv[1])
m = json.load(open('marcas.json'))
cel = glob.glob('celular/*.webm')[0]
pan = glob.glob('panel/*.webm')[0]
F = '/usr/share/fonts/opentype/inter/'
B, R = F + 'Inter-Bold.otf', F + 'Inter-Regular.otf'
fin, marcas = m['fin'], m['marcas']
t = [x['t'] for x in marcas] + [fin]

# Textos cortos: en vertical entra una línea por paso.
textos = [
    'Entra al link de tu club',
    'Elige día, cancha y horario',
    'Deja nombre y WhatsApp',
    'Y a vos ya te aparece el turno',
    'Paga la seña con Mercado Pago',
    'Se confirma solo en tu panel',
    'Comprobante con QR',
    'Sin contestar un solo mensaje',
]
# Momentos en que se ve el panel: la segunda mitad del paso 3 y todo el paso 5.
panel = [(t[3] + 2.2, t[4]), (t[5], t[6])]
en_panel = '+'.join(f'between(t,{a:.2f},{b:.2f})' for a, b in panel)
en_cel = f'not({en_panel})'

os.makedirs('txt', exist_ok=True)
dt = []
for i, texto in enumerate(textos):
    p = f'txt/v{i}.txt'
    open(p, 'w').write(texto)
    dt.append(
        f"drawtext=fontfile={B}:textfile={p}:fontsize=62:fontcolor=white:x=(w-tw)/2:y=1745"
        f":enable='between(t,{t[i]:.2f},{t[i + 1]:.2f})'"
    )
open('txt/vl1.txt', 'w').write('CELULAR DEL JUGADOR')
open('txt/vl2.txt', 'w').write('TU PANEL')

ALTO_CEL = 1540
ancho_cel = round(390 * ALTO_CEL / 844 / 2) * 2
fc = (
    f'color=c=0x0f1511:s=1080x1920:d={fin:.2f}[bg];'
    f'[0:v]crop=iw/2:ih/2:0:0,scale=-2:{ALTO_CEL}:flags=lanczos,setsar=1[c];'
    f"[1:v]trim=start={m['desfasePanel']:.3f},setpts=PTS-STARTPTS,crop=iw/2:ih/2:0:0,"
    # La columna de la Cancha 1 (con las horas) al lado del detalle del turno: se lee grande.
    f'split[pa][pb];[pa]crop=250:540:278:205[pc];[pb]crop=350:540:895:205[pd];'
    f'[pc][pd]hstack,scale=1040:-2:flags=lanczos,setsar=1[p];'
    f'[bg][c]overlay=(W-w)/2:150:shortest=1[v1];'
    f"[v1]drawbox=x=0:y=120:w=1080:h=1590:color=0x0f1511:t=fill:enable='{en_panel}'[v2];"
    f"[v2][p]overlay=(W-w)/2:(H-h)/2-60:enable='{en_panel}'[v3];"
    f"[v3]drawtext=fontfile={B}:textfile=txt/vl1.txt:fontsize=30:fontcolor=0x5cc27e:x=(w-tw)/2:y=90:enable='{en_cel}',"
    f"drawtext=fontfile={B}:textfile=txt/vl2.txt:fontsize=30:fontcolor=0x5cc27e:x=(w-tw)/2:y=330:enable='{en_panel}',"
    + ','.join(dt)
    + f',trim=duration={fin:.2f}[out]'
)
subprocess.run(
    ['ffmpeg', '-v', 'error', '-y', '-i', cel, '-i', pan, '-filter_complex', fc, '-map', '[out]', '-r', '30',
     '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', 'v-medio.mp4'],
    check=True,
)

dur = json.load(open('duraciones.json')) if os.path.exists('duraciones.json') else None
d_intro = max(3, dur['intro'] + 1.0) if dur else 3
d_cierre = max(4, dur['cierre'] + 1.6) if dur else 4


def tarjeta(nombre, l1, l2, d):
    open('txt/vt1.txt', 'w').write(l1)
    open('txt/vt2.txt', 'w').write(l2)
    vf = (
        f'drawtext=fontfile={B}:textfile=txt/vt1.txt:fontsize=120:fontcolor=white:x=(w-tw)/2:y=820,'
        f'drawtext=fontfile={R}:textfile=txt/vt2.txt:fontsize=52:fontcolor=0x5cc27e:x=(w-tw)/2:y=990,'
        f'fade=in:st=0:d=0.4,fade=out:st={d - 0.4}:d=0.4'
    )
    subprocess.run(
        ['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'color=c=0x0f1511:s=1080x1920:d={d}:r=30',
         '-vf', vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', nombre],
        check=True,
    )


tarjeta('v-intro.mp4', 'Canchería', 'Así reserva un jugador en tu club', d_intro)
tarjeta('v-cierre.mp4', 'tucancheria.com', 'Probalo gratis', d_cierre)
open('v-lista.txt', 'w').write("file 'v-intro.mp4'\nfile 'v-medio.mp4'\nfile 'v-cierre.mp4'\n")
destino = 'cancheria-vertical-sin-voz.mp4' if dur else 'cancheria-vertical.mp4'
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'v-lista.txt', '-c', 'copy', destino],
               check=True)
if dur:
    total = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0',
                                  destino], capture_output=True, text=True, check=True).stdout)
    pistas = [('voz/intro.wav', 0.4)]
    pistas += [(f'voz/paso{i}.wav', d_intro + x['t'] + 0.15) for i, x in enumerate(marcas)]
    pistas += [('voz/cierre.wav', total - d_cierre + 0.4)]
    args = ['ffmpeg', '-v', 'error', '-y', '-i', destino]
    for ruta, _ in pistas:
        args += ['-i', ruta]
    fca = ''.join(f'[{i + 1}:a]adelay={int(s * 1000)}:all=1[a{i}];' for i, (_, s) in enumerate(pistas))
    fca += ''.join(f'[a{i}]' for i in range(len(pistas)))
    fca += f'amix=inputs={len(pistas)}:normalize=0,loudnorm=I=-16:TP=-1.5,apad[voz]'
    subprocess.run(args + ['-filter_complex', fca, '-map', '0:v', '-map', '[voz]', '-c:v', 'copy', '-c:a', 'aac',
                           '-b:a', '160k', '-ar', '44100', '-t', f'{total:.3f}', 'cancheria-vertical.mp4'], check=True)
