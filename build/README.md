# build —— 自测夹具与单测

这个目录是「52户型装修设计」的自测入口：合成夹具 + 两个 node 单测 + 一个 CLI 对账样本。
夹具是**合成出来的假图纸**，不含任何真实房屋信息。

## 文件清单

| 文件 | 作用 |
| --- | --- |
| `make_fixture_plan.py` | 生成位图识墙夹具：`fixture_plan.png`（1200×900，12px 实心墙）、`fixture_plan.gray`（裸灰度，给 node 用）、`fixture_plan.meta.json`（真值） |
| `unit_imgwall.js` | 位图识墙单测：读 `.gray` → 跑 `app/imgwall.js` → 断言 |
| `overlay_imgwall.py` | 把识别结果叠回原图，输出 `imgwall_overlay.png`，肉眼核对是否贴合 |
| `make_fixture.py` | 由一份 `spec.json` 生成 CAD 图纸夹具（DXF） |
| `fixture_cad.dxf` | 已生成好的 DXF 夹具：27 面墙（双墙皮 + 端头）、25 条尺寸文字、6 个门弧、若干轴线 |
| `spec_fixture.json` | 与上面那份 DXF 配套的 27 墙 spec 样例（外框都是 17,580×7,330mm），给对账 CLI 当 `--spec` |
| `unit_dims.js` | 尺寸标注校核 + 多层切分单测：读 `fixture_cad.dxf` → 断言 |
| `unit_deliver.js` | 交付包单测：合成两层楼，验房间泛洪净面积、设备档案与 `entity_id` 唯一性、回路负荷/断路器核算、SVG 出图、看板坐标百分比、档案覆盖回灌；顺带用 `spec_fixture.json` 验「墙用节点 id 引用」能解开 |

## 跑单测

```bash
node build/unit_imgwall.js     # 默认读 build/fixture_plan.gray
node build/unit_dims.js        # 默认读 build/fixture_cad.dxf
node build/unit_deliver.js     # 自带合成两层楼，可选传一个 spec 夹具路径
```

三者都以 `PASS` 结尾、非 0 退出码表示失败。

`unit_imgwall.js` 断言：识别成功、墙 ≥8、竖墙 ≥3、横墙 ≥3；
`unit_dims.js` 断言：读到尺寸、单张平面切出 1 层、并排复制后切出 2 层、标注对账至少匹配 1 条；
`unit_deliver.js` 断言：3 个房间净面积合计 80~96 m²（外壳 96 m²）、24 个点位 `entity_id` 全合法且不重复、贴墙开关也能归到房间、照明/厨房插座/空调/地暖/16A 回路与断路器规格、看板百分比落在 0~100、2 层 × 3 张 PNG、手改档案能沿用。

## 重新生成夹具

`fixture_plan.png` / `.gray` / `.meta.json` 是二进制、不入库，缺了就重跑脚本（随机种子固定，结果可复现）：

```bash
pip install pillow
python build/make_fixture_plan.py
python build/overlay_imgwall.py     # 可选：出一张叠图核对
```

DXF 夹具由 spec 生成，默认读同目录 `spec_fixture.json`：

```bash
python build/make_fixture.py                                  # → build/fixture_cad.dxf
python build/make_fixture.py my_spec.json out/my_cad.dxf      # 换成自己的方案
```

`fixture_cad.dxf` 是文本文件（约 14KB，CRLF），已随仓库提供，一般不用重新生成。

## 装进软件实测

桌面版自带自测，夹具通过环境变量传进去：

```bash
# Windows PowerShell
$env:DS_SELFTEST_OUT = "D:\tmp\selftest\shot.png"   # 截图与报告输出目录
$env:DS_IMG_FILE = "E:\...\build\fixture_plan.png"
$env:DS_DXF_FILE = "E:\...\build\fixture_cad.dxf"
& "dist\win-unpacked\52户型装修设计.exe" --selftest
```

跑完在该目录下得到首屏/导入/整栋/3D/深色各一张截图、一份 `<name>.json` 统计、`audit-report.md`、`roundtrip.dxf`，
以及 `deliver/` 子目录（第 8 段「交付包」的完整产物：3 张 PNG + SVG + 设备清单 + 配电箱表 + 看板坐标 + HA YAML）。
夹具用的就是上面这两个文件：图片识墙段读 `fixture_plan.png`，DXF 段读 `fixture_cad.dxf`。

## 对账 CLI 样本

```bash
node tools/audit.mjs --spec build/spec_fixture.json --dxf build/fixture_cad.dxf --layers WALL --out build/audit
```

会输出 `spec_fixture-report.md` / `.json`：结构检查（短墙/重复墙/悬空端点/楼层雷同）、尺寸链、墙体往返（DXF 重解析后比墙数与外框宽深）。
