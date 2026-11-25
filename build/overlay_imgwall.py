# -*- coding: utf-8 -*-
"""把识墙结果叠回原图，肉眼核对（build/imgwall_overlay.png）。"""
import json, os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
res = json.load(open(os.path.join(HERE, 'unit_imgwall.json'), encoding='utf-8'))
px = res.get('wallsPx') or []
img = Image.open(os.path.join(HERE, 'fixture_plan.png')).convert('RGB')
ov = img.copy()
d = ImageDraw.Draw(ov, 'RGBA')
for w in px:
    if w['dir'] == 'v':
        x0, x1 = w['x'] - w['t'] / 2, w['x'] + w['t'] / 2
        d.rectangle([x0, w['y0'], x1, w['y1']], fill=(37, 99, 235, 60), outline=(29, 78, 216, 220))
    else:
        y0, y1 = w['y'] - w['t'] / 2, w['y'] + w['t'] / 2
        d.rectangle([w['x0'], y0, w['x1'], y1], fill=(37, 99, 235, 60), outline=(29, 78, 216, 220))

canvas = Image.new('RGB', (img.width * 2 + 20, img.height), (255, 255, 255))
canvas.paste(img, (0, 0))
canvas.paste(ov, (img.width + 20, 0))
canvas.save(os.path.join(HERE, 'imgwall_overlay.png'))
print('walls', len(px), '->', os.path.join(HERE, 'imgwall_overlay.png'))
