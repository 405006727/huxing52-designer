# -*- coding: utf-8 -*-
"""生成「位图户型识墙」用的合成夹具。

- build/fixture_plan.png   给软件里实测用（1200×900，白底，12px 实心墙）
- build/fixture_plan.gray  给 node 单测用（裸灰度：w,h,bytes 顺序存）
- build/fixture_plan.meta.json 记录真值尺寸（毫米），供比对

画法刻意混入真实户型图里的干扰：1px 家具外框、尺寸线+起止斜杠、房间名文字、
门弧线、彩色填色（客厅/卧室区块色）。
"""
import json
import os
import random
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1200, 900
WALL = 12          # 墙厚（px）
INK = (38, 38, 44)  # 墙体色
THIN = (150, 150, 158)  # 细线色

random.seed(20261125)
img = Image.new('RGB', (W, H), (252, 252, 253))
d = ImageDraw.Draw(img)

# 房间填色（模拟彩平图的淡色块）
d.rectangle([90, 90, 520, 430], fill=(238, 244, 252))   # 客厅
d.rectangle([534, 90, 760, 430], fill=(246, 241, 236))  # 卧1
d.rectangle([774, 90, 1110, 430], fill=(240, 247, 240)) # 卧2
d.rectangle([90, 444, 760, 780], fill=(247, 247, 242))  # 厨房+卫+走廊
d.rectangle([774, 444, 1110, 780], fill=(245, 242, 250))# 书房

def wall_v(x, y0, y1, t=WALL):
    d.rectangle([x - t // 2, y0, x + t // 2, y1], fill=INK)

def wall_h(y, x0, x1, t=WALL):
    d.rectangle([x0, y - t // 2, x1, y + t // 2], fill=INK)

# 外墙
wall_h(84, 84, 1122)
wall_h(786, 84, 1122)
wall_v(84, 84, 786)
wall_v(1122, 84, 786)

# 内墙（含门洞：留 90mm≈? 这里按 84px 的门洞）
wall_v(527, 84, 430)          # 客厅/卧1
wall_v(520, 470, 780)         # 厨房/走廊右侧墙（错位，测试非对齐）
wall_v(767, 84, 430)          # 卧1/卧2
wall_v(767, 470, 786)         # 书房左墙
wall_h(437, 84, 767)          # 上下分区墙
# 门洞：把两段墙断开（模拟门）
wall_h(437, 767, 1122)        # 书房上墙（另有洞口在下方竖墙）

# 门洞（人为断开外墙的一段，测长度过滤）
d.rectangle([560, 480, 640, 640], fill=(252, 252, 253))  # 挖一个门洞出来


# ---- 干扰 1：家具（1px 细线框 + 内部斜线）
def furniture(x0, y0, x1, y1):
    d.rectangle([x0, y0, x1, y1], outline=THIN, width=1)
    d.line([x0, y1, x1, y0], fill=THIN, width=1)

furniture(120, 120, 320, 260)      # 沙发
furniture(360, 130, 500, 300)      # 电视柜
furniture(560, 120, 740, 250)      # 床
furniture(800, 120, 1080, 240)     # 床2
furniture(120, 500, 460, 700)      # 橱柜
furniture(820, 500, 1080, 620)     # 书桌

# ---- 干扰 2：尺寸线（细线 + 45° 起止斜杠 + 数字
for x in (84, 527, 767, 1122):
    d.line([x, 820, x, 850], fill=THIN, width=1)
    d.line([x - 6, 812, x + 6, 858], fill=THIN, width=1)
d.line([84, 836, 1122, 836], fill=THIN, width=1)
for txt, x in (('2400', 300), ('4800', 640), ('3540', 940)):
    d.text((x, 806), txt, fill=(90, 90, 96))

# ---- 干扰 3：门弧线（1px 圆弧，常被误认成墙）
d.arc([560, 480, 720, 640], start=180, end=270, fill=THIN, width=1)
d.arc([900, 437, 1000, 537], start=0, end=90, fill=THIN, width=1)

# ---- 干扰 4：轴线（点划线）
for y in (300, 600):
    for x in range(100, 1100, 40):
        d.line([x, y, x + 18, y], fill=(205, 205, 210), width=1)

img.save(os.path.join(HERE, 'fixture_plan.png'))

# 裸灰度给 node 单测
gray = img.convert('L').tobytes()
with open(os.path.join(HERE, 'fixture_plan.gray'), 'wb') as f:
    f.write(W.to_bytes(4, 'little'))
    f.write(H.to_bytes(4, 'little'))
    f.write(gray)

meta = {
    'source': 'build/make_fixture_plan.py',
    'width': W,
    'height': H,
    'wallThicknessPx': WALL,
    'truth': {
        'note': '图上墙厚 12px；真值：外墙 4 道 + 内墙 5 段（竖墙 6 段 / 横墙 3 段，共 9 面）',
        'outerPx': [84, 84, 1122, 786],
        'realOuterMM': [12340, 8360],
        'mmPerPx': round(12340 / (1122 - 84), 3),
        'expectWalls': 9,
    },
}
with open(os.path.join(HERE, 'fixture_plan.meta.json'), 'w', encoding='utf-8') as f:
    json.dump(meta, f, ensure_ascii=False, indent=2)

print('ok', os.path.join(HERE, 'fixture_plan.png'), meta['truth']['mmPerPx'])
