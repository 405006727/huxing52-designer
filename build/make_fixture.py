# -*- coding: utf-8 -*-
"""
用一份 spec.json 生成自测用的 CAD 图纸夹具（DXF）。

每面墙按 CAD 常见画法出：两条墙皮线 + 两个端头；再加轴线（AXIS）与
尺寸文字（DIM，取墙长整数），另给前 6 面墙各加一个 450 半径的门弧（DOOR）。
这样一份夹具同时覆盖：双线墙识别、轴线/门弧/尺寸文字干扰、尺寸标注对账。

用法：
    python make_fixture.py                       # 默认读同目录 spec_fixture.json
    python make_fixture.py <spec.json> [out.dxf]

输出默认写到同目录 fixture_cad.dxf（CRLF）。仓库里那份 fixture_cad.dxf
即由 27 面墙的 spec 生成，口径见同目录 README.md。
"""
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'spec_fixture.json')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'fixture_cad.dxf')

spec = json.load(open(SPEC, encoding='utf-8'))
floors = spec.get('floors') or [spec]
f = floors[0]
walls = f['walls']
print('spec walls', len(walls), 'rooms', len(f.get('rooms') or []))

ent = []
def add(code, val):
    ent.append(str(code)); ent.append(str(val))

def line(x1, y1, x2, y2, layer='WALL'):
    add(0, 'LINE'); add(8, layer)
    add(10, f'{x1:.2f}'); add(20, f'{y1:.2f}'); add(30, '0.0')
    add(11, f'{x2:.2f}'); add(21, f'{y2:.2f}'); add(31, '0.0')

def arc(cx, cy, r, a1, a2, layer='DOOR'):
    add(0, 'ARC'); add(8, layer)
    add(10, f'{cx:.2f}'); add(20, f'{cy:.2f}'); add(30, '0.0')
    add(40, f'{r:.2f}'); add(50, f'{a1:.1f}'); add(51, f'{a2:.1f}')

def text(x, y, s, layer='DIM'):
    add(0, 'TEXT'); add(8, layer)
    add(10, f'{x:.2f}'); add(20, f'{y:.2f}'); add(30, '0.0'); add(40, '150')
    add(1, s)

# 每面墙按 CAD 的画法：两条墙皮线 + 两个端头
for w in walls:
    ax, ay = w['a']; bx, by = w['b']; t = w.get('t', 200) / 2.0
    dx, dy = bx - ax, by - ay
    L = math.hypot(dx, dy) or 1
    ux, uy = dx / L, dy / L
    nx, ny = -uy * t, ux * t
    # 两条墙皮
    line(ax + nx, ay + ny, bx + nx, by + ny)
    line(ax - nx, ay - ny, bx - nx, by - ny)
    # 端头
    line(ax + nx, ay + ny, ax - nx, ay - ny)
    line(bx + nx, by + ny, bx - nx, by - ny)
    # 附加噪声：轴线 + 尺寸文字
    line(ax, ay, bx, by, 'AXIS')
    text((ax + bx) / 2 + 100, (ay + by) / 2 - 200, f'{int(L)}')

# 门弧噪声
for w in walls[:6]:
    ax, ay = w['a']
    arc(ax, ay, 450, 0, 90)

hdr = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
       '0', 'SECTION', '2', 'TABLES', '0', 'ENDSEC',
       '0', 'SECTION', '2', 'ENTITIES']
tail = ['0', 'ENDSEC', '0', 'EOF']
with open(OUT, 'w', encoding='utf-8', newline='\r\n') as fh:
    fh.write('\n'.join(hdr + ent + tail))
print('fixture', OUT, os.path.getsize(OUT), 'bytes')
