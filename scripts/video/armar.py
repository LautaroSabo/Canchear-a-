# Arma cancheria-demo.mp4 con las dos grabaciones de apps/web/e2e/video-demo.spec.ts (necesita ffmpeg).
import json, glob, subprocess, os, sys
os.chdir(sys.argv[1])  # carpeta que usó VIDEO_DIR
m = json.load(open('marcas.json'))
cel = glob.glob('celular/*.webm')[0]; pan = glob.glob('panel/*.webm')[0]
F = '/usr/share/fonts/opentype/inter/'
B, SB, R = F+'Inter-Bold.otf', F+'Inter-SemiBold.otf', F+'Inter-Regular.otf'
fin = m['fin']
textos = {
 'El horario queda guardado mientras paga': 'Mientras paga, el horario queda reservado y al club ya le aparece',
 'Al club le aparece solo, ya pagado': 'Pagó: en el panel del club el turno pasa a confirmado, solo',
}
marcas = m['marcas']
os.makedirs('txt', exist_ok=True)
dt = []
for i, x in enumerate(marcas):
    a = x['t']; b = marcas[i+1]['t'] if i+1 < len(marcas) else fin
    p = f'txt/{i}.txt'; open(p,'w').write(textos.get(x['texto'], x['texto']))
    dt.append(f"drawtext=fontfile={SB}:textfile={p}:fontsize=46:fontcolor=white:x=(w-tw)/2:y=968:enable='between(t,{a:.2f},{b:.2f})'")
open('txt/l1.txt','w').write('CELULAR DEL JUGADOR'); open('txt/l2.txt','w').write('PANEL DEL CLUB')
fc = (
 f"color=c=0x0f1511:s=1920x1080:d={fin:.2f}[bg];"
 f"[0:v]crop=iw/2:ih/2:0:0,scale=-2:880:flags=lanczos,setsar=1[c];"
 f"[1:v]trim=start={m['desfasePanel']:.3f},setpts=PTS-STARTPTS,crop=iw/2:ih/2:0:0,scale=1240:-2:flags=lanczos,setsar=1[p];"
 f"[bg]drawbox=x=136:y=76:w={2+int(780*880/1688)+2+20}:h=904:color=0x2b372e:t=fill[bg2];"
 f"[bg2][c]overlay=148:88:shortest=1[v1];[v1][p]overlay=600:88[v2];"
 f"[v2]drawtext=fontfile={B}:textfile=txt/l1.txt:fontsize=20:fontcolor=0x5cc27e:x=148:y=44,"
 f"drawtext=fontfile={B}:textfile=txt/l2.txt:fontsize=20:fontcolor=0x5cc27e:x=600:y=44,"
 + ",".join(dt) + f",trim=duration={fin:.2f}[out]"
)
subprocess.run(['ffmpeg','-v','error','-y','-i',cel,'-i',pan,'-filter_complex',fc,'-map','[out]','-r','30','-c:v','libx264','-pix_fmt','yuv420p','-crf','20','medio.mp4'],check=True)
def tarjeta(nombre, l1, l2, dur):
    open('txt/t1.txt','w').write(l1); open('txt/t2.txt','w').write(l2)
    vf = (f"drawtext=fontfile={B}:textfile=txt/t1.txt:fontsize=110:fontcolor=white:x=(w-tw)/2:y=400,"
          f"drawtext=fontfile={R}:textfile=txt/t2.txt:fontsize=44:fontcolor=0x5cc27e:x=(w-tw)/2:y=560,"
          f"fade=in:st=0:d=0.4,fade=out:st={dur-0.4}:d=0.4")
    subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i',f'color=c=0x0f1511:s=1920x1080:d={dur}:r=30','-vf',vf,'-c:v','libx264','-pix_fmt','yuv420p','-crf','20',nombre],check=True)
# Con voz (scripts/video/voz.py), las tarjetas duran lo que tarda su frase.
dur = json.load(open('duraciones.json')) if os.path.exists('duraciones.json') else None
d_intro = max(3, dur['intro'] + 1.0) if dur else 3
d_cierre = max(4, dur['cierre'] + 1.6) if dur else 4
tarjeta('intro.mp4','Canchería','Así reserva un jugador en tu club',d_intro)
tarjeta('cierre.mp4','tucancheria.com','Reservas y señas sin contestar mensajes',d_cierre)
open('lista.txt','w').write("file 'intro.mp4'\nfile 'medio.mp4'\nfile 'cierre.mp4'\n")
destino = 'cancheria-demo-sin-voz.mp4' if dur else 'cancheria-demo.mp4'
subprocess.run(['ffmpeg','-v','error','-y','-f','concat','-safe','0','-i','lista.txt','-c','copy',destino],check=True)
if dur:
    # Cada frase en su momento: la intro sobre la tarjeta, cada paso en su marca, el cierre al final.
    pistas = [('voz/intro.wav', 0.4)]
    pistas += [(f'voz/paso{i}.wav', d_intro + x['t'] + 0.15) for i, x in enumerate(marcas)]
    total = float(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',destino],capture_output=True,text=True,check=True).stdout)
    pistas += [('voz/cierre.wav', total - d_cierre + 0.4)]
    args = ['ffmpeg','-v','error','-y','-i',destino]
    for ruta, _ in pistas: args += ['-i', ruta]
    fc = ''.join(f'[{i+1}:a]adelay={int(t*1000)}:all=1[a{i}];' for i, (_, t) in enumerate(pistas))
    fc += ''.join(f'[a{i}]' for i in range(len(pistas))) + f'amix=inputs={len(pistas)}:normalize=0,loudnorm=I=-16:TP=-1.5,apad[voz]'
    subprocess.run(args + ['-filter_complex', fc, '-map','0:v','-map','[voz]','-c:v','copy','-c:a','aac','-b:a','160k','-ar','44100','-t',f'{total:.3f}','cancheria-demo.mp4'], check=True)
