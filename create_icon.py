"""
SupportDeck Icon Generator — 톤온톤 디자인 (B안)
- 배경: deep navy 그라디언트
- 좌상단: 폴더 (노란 액센트)
- 우상단: 파랑 / 좌하단: 청록 / 우하단: 보라
"""
import struct
from io import BytesIO

from PIL import Image, ImageDraw


# ── 색상 (그라디언트 위→아래) ──
COLORS = {
    "bg_top":     (30, 37, 56, 255),     # #1e2538
    "bg_bottom":  (7, 10, 18, 255),      # #070a12
    "folder_top": (255, 214, 128, 255),  # #ffd680
    "folder_bot": (232, 154, 28, 255),   # #e89a1c
    "blue_top":   (126, 180, 255, 255),  # #7eb4ff
    "blue_bot":   (58, 123, 213, 255),   # #3a7bd5
    "teal_top":   (133, 232, 232, 255),  # #85e8e8
    "teal_bot":   (44, 154, 160, 255),   # #2c9aa0
    "purple_top": (196, 152, 255, 255),  # #c498ff
    "purple_bot": (123, 70, 212, 255),   # #7b46d4
}


def lerp(c1, c2, t):
    """두 색상 사이를 선형 보간."""
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(len(c1)))


def make_gradient(w, h, top, bottom):
    """세로 그라디언트 이미지 생성."""
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=lerp(top, bottom, t))
    return img


def make_rounded_mask(w, h, radius):
    """둥근 사각형 마스크 (L 모드, 흰=불투명)."""
    img = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([(0, 0), (w - 1, h - 1)], radius=radius, fill=255)
    return img


def make_folder_mask(w, h):
    """폴더 모양 마스크 — 본체 + 좌상단 탭 + 사선."""
    img = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(img)
    tab_h = int(h * 0.22)
    body_top = int(h * 0.18)
    tab_w = int(w * 0.50)
    slope_end = int(w * 0.62)
    body_r = max(1, w // 8)
    tab_r = max(1, w // 12)

    d.rounded_rectangle(
        [(0, body_top), (w - 1, h - 1)],
        radius=body_r, fill=255
    )
    d.rounded_rectangle(
        [(0, 0), (tab_w, body_top + body_r)],
        radius=tab_r, fill=255
    )
    d.polygon([
        (tab_w, 0),
        (slope_end, body_top),
        (tab_w, body_top),
    ], fill=255)
    return img


def paste_gradient_shape(target, bbox, top, bottom, mask):
    x1, y1, x2, y2 = bbox
    w = x2 - x1
    h = y2 - y1
    if w <= 0 or h <= 0:
        return
    grad = make_gradient(w, h, top, bottom)
    target.paste(grad, (x1, y1), mask)


def create_icon_image(size):
    """주어진 크기의 아이콘 이미지 생성. 2x oversample → LANCZOS resize."""
    s = size * 2
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    # 배경
    bg_radius = max(2, s * 24 // 128)
    bg_mask = make_rounded_mask(s, s, bg_radius)
    paste_gradient_shape(img, (0, 0, s, s),
                         COLORS["bg_top"], COLORS["bg_bottom"], bg_mask)

    # 4개 버튼 위치
    btn_pad = s * 22 // 128
    btn_w = s * 36 // 128
    btn_h = s * 40 // 128
    btn_r = max(1, s * 6 // 128)
    half = s // 2
    inner_pad = btn_pad // 2

    folder_bbox = (btn_pad, btn_pad,
                   btn_pad + btn_w, btn_pad + btn_h)
    blue_bbox = (half + inner_pad, btn_pad,
                 half + inner_pad + btn_w, btn_pad + btn_h)
    teal_bbox = (btn_pad, half + inner_pad,
                 btn_pad + btn_w, half + inner_pad + btn_h)
    purple_bbox = (half + inner_pad, half + inner_pad,
                   half + inner_pad + btn_w, half + inner_pad + btn_h)

    folder_mask = make_folder_mask(btn_w, btn_h)
    paste_gradient_shape(img, folder_bbox,
                         COLORS["folder_top"], COLORS["folder_bot"], folder_mask)

    btn_mask = make_rounded_mask(btn_w, btn_h, btn_r)
    paste_gradient_shape(img, blue_bbox,
                         COLORS["blue_top"], COLORS["blue_bot"], btn_mask)
    paste_gradient_shape(img, teal_bbox,
                         COLORS["teal_top"], COLORS["teal_bot"], btn_mask)
    paste_gradient_shape(img, purple_bbox,
                         COLORS["purple_top"], COLORS["purple_bot"], btn_mask)

    return img.resize((size, size), Image.LANCZOS)


def write_ico(filename, images_by_size):
    """각 사이즈별 PIL 이미지로 multi-resolution ICO 파일 직접 작성."""
    sizes = sorted(images_by_size.keys())
    n = len(sizes)

    png_blobs = []
    for sz in sizes:
        buf = BytesIO()
        images_by_size[sz].save(buf, format="PNG")
        png_blobs.append(buf.getvalue())

    with open(filename, "wb") as f:
        # ICONDIR (6 bytes)
        f.write(struct.pack("<HHH", 0, 1, n))

        # ICONDIRENTRY (16 bytes each)
        offset = 6 + 16 * n
        for sz, blob in zip(sizes, png_blobs):
            w_byte = 0 if sz >= 256 else sz
            h_byte = 0 if sz >= 256 else sz
            f.write(struct.pack(
                "<BBBBHHII",
                w_byte, h_byte,
                0, 0,
                1, 32,
                len(blob), offset
            ))
            offset += len(blob)

        for blob in png_blobs:
            f.write(blob)


def main():
    sizes = [16, 32, 48, 64, 128, 256]
    images_by_size = {sz: create_icon_image(sz) for sz in sizes}
    write_ico("icon.ico", images_by_size)
    images_by_size[256].save("icon_preview.png")
    print("icon.ico created with tone-on-tone design (B)")
    print(f"  sizes: {sizes}")


if __name__ == "__main__":
    main()
