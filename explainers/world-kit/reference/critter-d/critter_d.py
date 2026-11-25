import json
INK="#171717"; PAPER="#F3F0EA"; ORANGE="#FF5E1A"; GREEN="#138510"; WHITE="#FFFFFF"; GREY="#E5E5E5"
def f(x): return f"{x:.1f}".rstrip('0').rstrip('.')

# ---------- moods ----------
M={
 "neutral":  dict(p=(0,0),lid=(.06,.06),cr=False,es=(1,1),tilt=0,mouth="M88 140 Q100 147 112 140",arms=("down","down")),
 "happy":    dict(p=(0,-2),lid=(0,0),cr=True,es=(1,1),tilt=0,mouth="M84 136 Q100 156 116 136 Z",arms=("up","up")),
 "curious":  dict(p=(6,-6),lid=(0,0),cr=False,es=(.92,1.14),tilt=-7,mouth="M92 141 Q100 145 108 141",arms=("down","point")),
 "focused":  dict(p=(0,3),lid=(.38,.38),cr=False,es=(1,1),tilt=0,mouth="M90 142 L110 142",arms=("down","chin"),small=True),
 "surprised":dict(p=(0,0),lid=(0,0),cr=False,es=(1.16,1.16),tilt=0,mouth="O",arms=("shrug","shrug"),small=True),
 "sly":      dict(p=(8,2),lid=(.5,.42),cr=False,es=(1,1),tilt=4,mouth="M88 142 Q102 146 113 136",arms=("hips","chin")),
 "worried":  dict(p=(-1,5),lid=(.42,.04),cr=False,es=(1,1),tilt=0,mouth="M86 144 Q93 138 100 143 Q107 148 114 142",arms=("cheek","cheek")),
 "angry":    dict(p=(0,4),lid=(.08,.55),cr=False,es=(1,1),tilt=0,mouth="M88 144 Q100 138 112 144",arms=("fist","fist")),
 "proud":    dict(p=(0,-3),lid=(.34,.34),cr=True,es=(1,1),tilt=-3,mouth="M86 138 Q100 150 114 138",arms=("hips","hips")),
 "sleepy":   dict(p=(0,6),lid=(.64,.64),cr=False,es=(1,1),tilt=2,mouth="M93 142 Q100 146 107 142",arms=("droop","droop")),
}
# left-arm paths (shoulder -> hand); right arm mirrors x -> 200-x
ARM={
 "down": [(33,116),(19,134),(23,152)],
 "up":   [(35,104),(15,86),(20,60)],
 "hips": [(33,110),(6,126),(31,150)],
 "cheek":[(34,120),(20,104),(44,90)],
 "point":[(33,112),(16,104),(4,86)],
 "fist": [(33,114),(24,128),(15,144)],
 "chin": [(34,122),(50,166),(80,148)],
 "shrug":[(33,110),(14,112),(10,90)],
 "droop":[(33,120),(28,142),(31,160)],
 "wave": [(35,104),(15,86),(20,60)],
}
EYES=[(74,96,-1),(126,96,1)]
RX,RY=20,24

# ---------- pupil styles ----------
# returns svg for the pupil group (inside eye), given eye centre, scale, offset
def pupil(style,cx,cy,s,px,py,small):
    k=0.62 if small else 1
    if style=="dot":      # today's: small ink dot + catch-light
        r=10*s*k
        return (f'<circle cx="{f(cx+px)}" cy="{f(cy+py)}" r="{f(r)}" fill="{INK}"></circle>'
                f'<circle cx="{f(cx+px+r*.38)}" cy="{f(cy+py-r*.42)}" r="{f(max(2.2,r*.3))}" fill="#FFFFFF"></circle>')
    if style=="orb":      # big orb: fills most of the eye, two catch-lights
        rx,ry=14.5*s*k,17*s*k
        return (f'<ellipse cx="{f(cx+px*.7)}" cy="{f(cy+py*.7)}" rx="{f(rx)}" ry="{f(ry)}" fill="{INK}"></ellipse>'
                f'<circle cx="{f(cx+px*.7+rx*.38)}" cy="{f(cy+py*.7-ry*.4)}" r="{f(max(2.6,rx*.33))}" fill="#FFFFFF"></circle>'
                f'<circle cx="{f(cx+px*.7-rx*.35)}" cy="{f(cy+py*.7+ry*.42)}" r="{f(max(1.4,rx*.13))}" fill="#FFFFFF"></circle>')
    if style=="pill":     # tall pill pupil, glances read strongly
        w,h=11*s*k,22*s*k
        return (f'<rect x="{f(cx+px-w/2)}" y="{f(cy+py-h/2)}" width="{f(w)}" height="{f(h)}" rx="{f(w/2)}" fill="{INK}"></rect>'
                f'<circle cx="{f(cx+px+w*.1)}" cy="{f(cy+py-h*.26)}" r="{f(max(1.8,w*.22))}" fill="#FFFFFF"></circle>')
    return ""

def eye(cx,cy,side,m,color,s,blink,look,pstyle,eyew):
    o=[f'<g class="{blink}">']
    px,py=m["p"]
    if pstyle=="solid":   # no whites: the whole eye is ink
        rx,ry=(15*s,19*s) if not m.get("small") else (11*s,14*s)
        o.append(f'<g class="{look}"><ellipse cx="{f(cx+px*.5)}" cy="{f(cy+py*.5)}" rx="{f(rx)}" ry="{f(ry)}" fill="{INK}"></ellipse>'
                 f'<circle cx="{f(cx+px*.5+rx*.35)}" cy="{f(cy+py*.5-ry*.38)}" r="{f(rx*.3)}" fill="#FFFFFF"></circle></g>')
        ry_=19*s; rx_=15*s
    elif pstyle in ("calm","simple","plain","plain1"):
        big=pstyle in ("plain","plain1")
        rx_,ry_=(RX*s,RY*s) if big else (15*s,18*s)
        k=.7 if m.get("small") else 1
        r=(11.5 if big else 8.5)*s*k; qx,qy=px*.8,py*.8
        o.append(f'<ellipse cx="{f(cx)}" cy="{f(cy)}" rx="{f(rx_)}" ry="{f(ry_)}" fill="{eyew}"></ellipse>')
        hl=f'<circle cx="{f(cx+qx+r*.36)}" cy="{f(cy+qy-r*.4)}" r="{f(max(1.8,r*.28))}" fill="#FFFFFF"></circle>' if pstyle in ("calm","plain1") else ""
        o.append(f'<g class="{look}"><circle cx="{f(cx+qx)}" cy="{f(cy+qy)}" r="{f(r)}" fill="{INK}"></circle>{hl}</g>')
    else:
        rx_,ry_=RX*s,RY*s
        o.append(f'<ellipse cx="{f(cx)}" cy="{f(cy)}" rx="{f(rx_)}" ry="{f(ry_)}" fill="{eyew}"></ellipse>')
        o.append(f'<g class="{look}">{pupil(pstyle,cx,cy,s,px,py,m.get("small"))}</g>')
    lo,li=m["lid"]
    if lo>0 or li>0:
        y0=cy-ry_-3; H=2*ry_+6
        yo=y0+lo*H; yi=y0+li*H
        xl,xr=cx-rx_-4,cx+rx_+4
        yl,yr=(yo,yi) if side<0 else (yi,yo)
        o.append(f'<polygon points="{f(xl)},{f(y0-2)} {f(xr)},{f(y0-2)} {f(xr)},{f(yr)} {f(xl)},{f(yl)}" fill="{color}"></polygon>')
    if m["cr"]:
        o.append(f'<ellipse cx="{f(cx)}" cy="{f(cy+ry_*1.05)}" rx="{f(rx_*1.45)}" ry="{f(ry_*.82)}" fill="{color}"></ellipse>')
    o.append('</g>')
    return "".join(o)

def arm(pose,side,cls="",chubby=False):
    pts=ARM[pose]
    if side>0: pts=[(200-x,y) for x,y in pts]
    if chubby:
        (a0,b0)=pts[0]; pts=[(a0+(x-a0)*.82,b0+(y-b0)*.82) for x,y in pts]
        (a,b),(c,d),(e,g)=pts
        return (f'<g class="{cls}"><path d="M{f(a)} {f(b)} Q{f(c)} {f(d)} {f(e)} {f(g)}" fill="none" stroke="{INK}" stroke-width="20" stroke-linecap="round"></path>'
                f'<circle cx="{f(e)}" cy="{f(g)}" r="12" fill="{INK}"></circle></g>')
    (a,b),(c,d),(e,g)=pts
    return (f'<g class="{cls}"><path d="M{a} {b} Q{c} {d} {e} {g}" fill="none" stroke="{INK}" stroke-width="11" stroke-linecap="round"></path>'
            f'<circle cx="{e}" cy="{g}" r="8.5" fill="{INK}"></circle></g>')

def acc(kind,body):
    c=WHITE if body==INK else INK   # a prop never matches the body
    if kind=="glasses":
        return (f'<g fill="none" stroke="{c}" stroke-width="5"><circle cx="74" cy="96" r="27"></circle><circle cx="126" cy="96" r="27"></circle>'
                f'<path d="M101 94 Q100 90 99 94"></path></g>')
    if kind=="cap":
        return f'<path d="M44 66 Q48 22 100 20 Q152 22 156 66 Z" fill="{c}"></path><path d="M120 62 L178 62 Q182 70 170 72 L120 72 Z" fill="{c}"></path>'
    if kind=="headphones":
        return (f'<path d="M34 92 Q36 18 100 16 Q164 18 166 92" fill="none" stroke="{c}" stroke-width="8" stroke-linecap="round"></path>'
                f'<rect x="20" y="80" width="22" height="40" rx="10" fill="{c}"></rect><rect x="158" y="80" width="22" height="40" rx="10" fill="{c}"></rect>')
    if kind=="bowtie":
        return f'<path d="M100 160 L80 150 L80 172 Z M100 160 L120 150 L120 172 Z" fill="{c}"></path><circle cx="100" cy="161" r="5" fill="{c}"></circle>'
    if kind=="chef":
        return (f'<path d="M62 56 L62 34 Q50 30 54 16 Q62 2 78 10 Q88 -2 100 6 Q112 -2 122 10 Q138 2 146 16 Q150 30 138 34 L138 56 Z" fill="#FFFFFF" stroke="{INK}" stroke-width="3"></path>')
    if kind=="beanie":
        return f'<path d="M40 62 Q42 18 100 16 Q158 18 160 62 Z" fill="{c}"></path><circle cx="100" cy="12" r="10" fill="{c}"></circle>'
    return ""

def eyes_c(m,color,look,blink,lidcol=None,glow=True):
    o=[f'<g class="{look}">']
    px,py=m["p"]; px*=.8; py*=.8
    g=f'filter: drop-shadow(0 0 6px {color})' if glow else ''
    lidcol=lidcol or INK
    for (cx,cy,side),s in zip(EYES,m["es"]):
        cx+=px; cy+=py+6
        if m["cr"]:
            o.append(f'<g class="{blink}"><path d="M{f(cx-15*s)} {f(cy+6)} Q{f(cx)} {f(cy-16*s)} {f(cx+15*s)} {f(cy+6)}" fill="none" stroke="{color}" stroke-width="10" stroke-linecap="round" style="{g}"></path></g>')
            continue
        if m.get("small") and m["lid"]==(0,0):
            o.append(f'<g class="{blink}"><circle cx="{f(cx)}" cy="{f(cy)}" r="{f(19*s)}" fill="{color}" style="{g}"></circle></g>')
            continue
        w,h=28*s,46*s
        part=[f'<rect x="{f(cx-w/2)}" y="{f(cy-h/2)}" width="{f(w)}" height="{f(h)}" rx="{f(w/2)}" fill="{color}" style="{g}"></rect>']
        lo,li=m["lid"]
        if lo>0.1 or li>0.1:
            y0=cy-h/2-2; H=h+4
            yo=y0+lo*H; yi=y0+li*H
            xl,xr=cx-w/2-8,cx+w/2+8
            yl,yr=(yo,yi) if side<0 else (yi,yo)
            part.append(f'<polygon points="{f(xl)},{f(y0-12)} {f(xr)},{f(y0-12)} {f(xr)},{f(yr)} {f(xl)},{f(yl)}" fill="{lidcol}"></polygon>')
        o.append(f'<g class="{blink}">'+"".join(part)+'</g>')
    o.append('</g>')
    return "".join(o)

def critter(mood="neutral",color=ORANGE,size=180,variant="a",anim=False,state=None,accessory=None,pstyle="orb",limbs=True,eyecol=None):
    chubby = variant=="d"
    m=dict(M[mood])
    look={"idle":"look","think":"think","work":"scan","wait":"waitlook","done":""}.get(state,"look") if anim else ""
    blink="blink" if anim and state!="done" else ""
    bob={"work":"bob-fast","wait":"hop","done":"bounce"}.get(state,"bob") if anim else ""
    arms=m["arms"]
    if anim and state=="think": arms=("down","chin")
    if anim and state=="wait": arms=("down","wave")
    if anim and state=="done": arms=("up","up")
    if anim and state=="work": arms=("down","down")
    eyew=GREY if color==WHITE else WHITE
    edge=f' stroke="{INK}" stroke-width="3"' if color==WHITE else ""
    o=[f'<svg width="{size}" height="{size}" viewBox="0 0 200 200" aria-hidden="true" style="display: block; overflow: visible">']
    o.append(f'<ellipse cx="100" cy="192" rx="58" ry="7" fill="{INK}" fill-opacity="0.10"></ellipse>')
    o.append(f'<g class="{bob}"><g transform="rotate({m["tilt"]} 100 110)">')
    if limbs:
        lc="step-l" if anim and state=="work" else ""; rc="step-r" if anim and state=="work" else ""
        o.append(f'<rect class="{lc}" x="68" y="158" width="20" height="32" rx="10" fill="{INK}"></rect><rect class="{rc}" x="112" y="158" width="20" height="32" rx="10" fill="{INK}"></rect>')
    if variant=="c":
        o.append(f'<rect x="26" y="40" width="148" height="136" rx="46" fill="{INK}"></rect>')
        o.append(eyes_c(m,color,look,blink))
    elif variant=="d":
        o.append(f'<rect x="26" y="40" width="148" height="136" rx="46" fill="{color}"{edge}></rect>')
        for (cx,cy,side),s in zip(EYES,m["es"]):
            o.append(eye(cx,cy,side,m,color,s,blink,look,pstyle,eyew))
    elif variant=="c2":
        o.append(f'<rect x="26" y="40" width="148" height="136" rx="46" fill="{color}"{edge}></rect>')
        o.append(eyes_c(m,eyecol or (WHITE if color==INK else INK),look,blink,lidcol=color,glow=False))
    else:
        o.append(f'<rect x="30" y="44" width="140" height="132" rx="56" fill="{color}"{edge}></rect>')
        for (cx,cy,side),s in zip(EYES,m["es"]):
            o.append(eye(cx,cy,side,m,color,s,blink,look,pstyle,eyew))
        if variant=="b":
            mc=WHITE if color==INK else INK
            if m["mouth"]=="O": o.append(f'<ellipse cx="100" cy="146" rx="7" ry="9" fill="{mc}"></ellipse>')
            elif m["mouth"].endswith("Z"): o.append(f'<path d="{m["mouth"]}" fill="{mc}"></path>')
            else: o.append(f'<path d="{m["mouth"]}" fill="none" stroke="{mc}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"></path>')
    if limbs:
        o.append(arm(arms[0],-1,"",chubby))
        o.append(arm(arms[1],1,"wave" if arms[1]=="wave" else "",chubby))
    if accessory: o.append(acc(accessory,color if variant!="c" else INK))
    o.append('</g></g></svg>')
    return "".join(o)

CSS="""
body{margin:0}
a{color:#171717}a:hover{color:#FF5E1A}
.blink{transform-box:fill-box;transform-origin:center;animation:blink 4.6s infinite}
.look{animation:look 7s infinite cubic-bezier(.16,1,.3,1)}
.think{animation:think 5s infinite ease-in-out}
.scan{animation:scan 1.6s infinite ease-in-out}
.waitlook{animation:waitlook 3s infinite cubic-bezier(.16,1,.3,1)}
.bob{animation:bob 2.8s infinite ease-in-out}
.bob-fast{animation:bob 0.8s infinite ease-in-out}
.hop{transform-box:fill-box;transform-origin:50% 100%;animation:hop 3s infinite}
.bounce{transform-box:fill-box;transform-origin:50% 100%;animation:bounce 1.4s infinite}
.wave{transform-box:view-box;transform-origin:165px 104px;animation:wave 1s infinite ease-in-out}
.step-l{animation:step 0.8s infinite ease-in-out}
.step-r{animation:step 0.8s infinite ease-in-out;animation-delay:-0.4s}
@keyframes blink{0%,44%,50%,100%{transform:scaleY(1)}47%{transform:scaleY(.08)}}
@keyframes look{0%,10%{transform:translate(0,0)}16%,36%{transform:translate(6px,-3px)}42%,60%{transform:translate(-6px,1px)}66%,82%{transform:translate(2px,4px)}88%,100%{transform:translate(0,0)}}
@keyframes think{0%,100%{transform:translate(-5px,-7px)}50%{transform:translate(4px,-8px)}}
@keyframes scan{0%,100%{transform:translate(-6px,3px)}50%{transform:translate(6px,3px)}}
@keyframes waitlook{0%,60%{transform:translate(0,0)}68%,92%{transform:translate(0,-5px)}100%{transform:translate(0,0)}}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes hop{0%,62%,78%,100%{transform:translateY(0) scale(1,1)}66%{transform:translateY(0) scale(1.06,.92)}71%{transform:translateY(-14px) scale(.96,1.05)}}
@keyframes bounce{0%,100%{transform:translateY(0) scale(1,1)}12%{transform:scale(1.07,.9)}30%{transform:translateY(-12px) scale(.95,1.06)}48%{transform:translateY(0) scale(1.04,.95)}60%{transform:scale(1,1)}}
@keyframes wave{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-22deg)}}
@keyframes step{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@media (prefers-reduced-motion: reduce){.blink,.look,.think,.scan,.waitlook,.bob,.bob-fast,.hop,.bounce,.wave,.step-l,.step-r{animation:none}}
"""
FONT='<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,300..900&amp;family=Roboto:wght@300;400;500&amp;display=swap">'
H="font-family: Archivo, sans-serif; font-stretch: 125%; font-weight: 800; letter-spacing: -0.02em; margin: 0"
EB="font-family: Roboto, sans-serif; font-weight: 500; font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase; margin: 0"
BODY="font-family: Roboto, sans-serif; font-weight: 300; font-size: 18px; line-height: 1.5; margin: 0"
LBL="font-family: Roboto, sans-serif; font-weight: 500; font-size: 14px; margin: 0"
SUB="font-family: Roboto, sans-serif; font-weight: 400; font-size: 13px; margin: 0"

def page(title,w,h,inner,bg=PAPER,fg=INK):
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
{FONT}
<style>{CSS}</style>
</helmet>
<div style="width: {w}px; min-height: {h}px; box-sizing: border-box; padding: 72px 80px; background: {bg}; color: {fg}; font-family: Roboto, sans-serif; display: flex; flex-direction: column; gap: 56px">
{inner}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":{w},"height":{h}}}}}'>
class Component extends DCLogic {{
renderVals() {{
return {{}};
}}
}}
</script>
</body>
</html>
'''
def header(eyebrow,title,body,dark=False):
    return f'''<div style="display: flex; flex-direction: column; gap: 16px; max-width: 980px">
<p style="{EB}; color: {'#3FBF3B' if dark else GREEN}">{eyebrow}</p>
<h1 style="{H}; font-size: 52px; line-height: 1.05; color: {WHITE if dark else INK}">{title}</h1>
<p style="{BODY}; color: {'#D4D4D4' if dark else INK}">{body}</p>
</div>'''
def cell(svg,label,sub=None,bg="#FFFFFF",dark=False,h=240):
    lc=WHITE if dark else INK; sc="#A3A3A3" if dark else "#525252"
    s=f'<p style="{SUB}; color: {sc}">{sub}</p>' if sub else ""
    return f'''<div style="display: flex; flex-direction: column; gap: 10px">
<div style="background: {bg}; border-radius: 16px; height: {h}px; display: flex; align-items: center; justify-content: center">{svg}</div>
<p style="{LBL}; color: {lc}">{label}</p>{s}
</div>'''
def grid(cells,n): return f'<div style="display: grid; grid-template-columns: repeat({n}, minmax(0, 1fr)); gap: 24px">'+"".join(cells)+'</div>'
def section(t,content,dark=False,note=None):
    n=f'<p style="{SUB}; font-size: 15px; color: {"#A3A3A3" if dark else "#525252"}">{note}</p>' if note else ""
    return f'<div style="display: flex; flex-direction: column; gap: 16px"><h2 style="{H}; font-size: 24px; color: {WHITE if dark else INK}">{t}</h2>{n}{content}</div>'
def hero_row(svg,points,dark=False,bg="#FFFFFF"):
    lc=WHITE if dark else INK; bc="#D4D4D4" if dark else "#404040"
    lis="".join(f'<li style="{BODY}; font-size: 17px; color: {bc}"><span style="font-weight: 500; color: {lc}">{a}</span> {b}</li>' for a,b in points)
    return f'''<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px">
<div style="background: {bg}; border-radius: 24px; height: 440px; display: flex; align-items: center; justify-content: center">{svg}</div>
<div style="display: flex; flex-direction: column; justify-content: center; gap: 8px; padding: 0 24px">
<p style="{EB}; color: {'#3FBF3B' if dark else GREEN}">Round 2 · what changed</p>
<ul style="margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 14px">{lis}</ul>
</div></div>'''

moods=list(M)
CASTSPEC=[("librarian","sly",GREEN,"green","glasses"),("builder","focused",WHITE,"white","cap"),("developer","curious",INK,"ink","headphones"),
          ("host","proud",WHITE,"white","bowtie"),("cook","happy",INK,"ink","chef"),("barista","sleepy",GREEN,"green","beanie")]
CASTBG=PAPER  # cast sits on the reel's paper ground
def cast(variant,dark=False):
    cells=[]
    for job,md,col,name,a in CASTSPEC:
        if variant=="c":
            cells.append(cell(critter(md,col if col!=INK else WHITE,size=150,variant="c",accessory=a),f"{job} · {'white' if col==INK else name} glow",md,bg="#262626",dark=True,h=220))
        else:
            cells.append(cell(critter(md,col,size=150,variant=variant,accessory=a),f"{job} · {name}",md,bg=PAPER,h=220))
    return grid(cells,6)
PAL='<div style="display: flex; gap: 12px; flex-wrap: wrap">'+"".join(
    f'<div style="display: flex; align-items: center; gap: 8px; background: #FFFFFF; border-radius: 9999px; padding: 6px 14px 6px 6px"><span style="width: 24px; height: 24px; border-radius: 9999px; background: {c}; border: 1px solid #D4D4D4"></span><span style="{SUB}; color: {INK}">{n} {c}</span></div>'
    for n,c in [("Helios orange · hero only",ORANGE),("Helios green",GREEN),("Ink",INK),("White",WHITE),("Eye white on a white body",GREY)])+'</div>'
CASTNOTE="Cast bodies come only from the official palette: Helios green #138510, ink #171717 and white #FFFFFF. Orange stays the hero's alone. Props are ink, or white on an ink body, so a prop never matches its body. The white critter keeps a 3px ink edge and grey #E5E5E5 eye whites, or it would disappear on paper."

A=header("Direction A · round 2","Eyes do the talking, now with arms and legs","Same flat pebble and eye system, with ink arms and legs back. Each mood now has a pose, the pupils are bigger orbs, and the cast uses only the brand palette.")
A+=hero_row(critter("neutral",size=320,anim=True,state="idle"),[
 ("Arms and legs:","ink, rounded caps, a dot hand. Each of the ten moods has its own arm pose (up, hips, cheeks, point, chin, shrug, fists, droop)."),
 ("Pupils:","now a big ink orb that fills most of the eye, with a main catch-light and a small second one. The alternatives are on the pupil study board."),
 ("Colour:","orange hero, then green, ink and white for the cast. No other hues."),
 ("Still gone:","stipple, outline (except on the white critter), wobble, brows, mouth."),
])
A+=section("Ten moods, eyes and pose",grid([cell(critter(k,size=170),k) for k in moods],5))
A+=section("The cast · brand palette only",PAL+cast("a"),note=CASTNOTE)

B=header("Direction B · round 2","Eyes, mouth, arms and legs","Direction A plus a small mouth. The mouth is ink, or white on the ink critter.")
B+=hero_row(critter("happy",size=300,variant="b",anim=True,state="idle"),[
 ("Arms and legs:","the same ink limbs and poses as A."),
 ("Pupils:","the same big orbs; the mouth stays small so the eyes still lead."),
 ("Colour:","orange hero; green, ink and white cast."),
 ("Mouth on ink:","flips to white, the same rule as the props."),
])
B+=section("Ten moods, eyes, mouth and pose",grid([cell(critter(k,size=170,variant="b"),k) for k in moods],5))
B+=section("The cast · brand palette only",PAL+cast("b"),note=CASTNOTE)

DK="#262626"
C=header("Direction C · round 2","Screen face, with arms and legs","An ink tile with glowing pill eyes, now with ink arms and legs. Only the eye glow changes between characters: orange for the hero, then green or white for the cast.",dark=True)
C+=hero_row(critter("neutral",size=300,variant="c",anim=True,state="idle"),[
 ("Arms and legs:","ink limbs on an ink body read as one silhouette, which keeps it graphic."),
 ("Eyes:","the eyes are the pupils here, so the pupil study doesn't apply to this direction."),
 ("Colour:","the eye glow is the only colour: orange hero, green or white cast."),
 ("Trade-off:","on paper scenes the whole cast is the same black tile; only the glow and props tell them apart."),
],dark=True,bg=DK)
C+=section("Ten moods",grid([cell(critter(k,size=170,variant="c"),k,bg=DK,dark=True) for k in moods],5),dark=True)
C+=section("The cast · green and white glows",cast("c"),dark=True)

PS=[("dot","1 · Dot","Round 1's pupil: a small ink dot in a big white. Calm, but glances read small."),
    ("orb","2 · Orb (now the default)","Fills most of the eye, with two catch-lights. The most expressive and cute; reads at sidebar size."),
    ("pill","3 · Pill","A tall pupil. Side glances read very strongly and the look is a touch more graphic and less babyish."),
    ("solid","4 · Solid","No whites: the eye is all pupil. The simplest, but with less room for glances; the lids do all the work.")]
PU=header("Pupil study","Four pupils on the same critter","Each column is live, so the glances and blinks show how each pupil moves. The rows below show the same pupil across four moods.")
PU+=grid([cell(critter("neutral",size=220,anim=True,state="idle",pstyle=k),t,d,h=280) for k,t,d in PS],4)
for mood in ["happy","sly","worried","angry"]:
    PU+=section(mood,grid([cell(critter(mood,size=150,pstyle=k),t.split(" (")[0],h=200) for k,t,d in PS],4))

ST=[("idle","neutral","Idle","Glances around, blinks, slow bob."),
    ("think","neutral","Thinking","Hand to chin, pupils drift up."),
    ("work","focused","Working","Focused lids, pupils scan, feet step in place."),
    ("wait","surprised","Needs you","Looks out, waves, small hop."),
    ("done","happy","Done","Arms up, happy crescents, bounce.")]
MO=header("Motion · round 2","The eyes and limbs carry the state","Each loop is live. A beat changes state through the eyes, the arms and a squash, not by swapping the drawing.")
MO+=section("Direction A",grid([cell(critter(md,size=170,anim=True,state=s),t,d) for s,md,t,d in ST],5))
MO+=section("Direction B",grid([cell(critter(md,size=170,variant="b",anim=True,state=s),t,d) for s,md,t,d in ST],5))
MO+=section("Direction C",grid([cell(critter(md,size=170,variant="c",anim=True,state=s),t,d,bg=DK,dark=True) for s,md,t,d in ST],5))

out={"Main.dc.html":("Direction A · Eyes do the talking",A,PAPER,INK,2150),
     "Direction-B.dc.html":("Direction B · Eyes, mouth and feet",B,PAPER,INK,2100),
     "Direction-C.dc.html":("Direction C · Screen face",C,"#121212",WHITE,2050),
     "Motion.dc.html":("Motion · eye states",MO,PAPER,INK,1650),
     "Pupils.dc.html":("Pupil study",PU,PAPER,INK,1900)}
if __name__=="__main__":
    for fn,(t,inner,bg,fg,h) in out.items():
        open(f"/home/claude/canvas/project/{fn}","w").write(page(t,1440,h,inner,bg,fg))
