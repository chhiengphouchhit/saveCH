import math
from PIL import Image, ImageDraw, ImageFilter, ImageFont

def create_savech_icon(size=512, is_maskable=True):
    # Create base RGBA image
    img = Image.new('RGBA', (size, size), (2, 6, 23, 255))
    draw = ImageDraw.Draw(img)

    scale = size / 512.0

    # 1. Background Gradient (Full bleed, 100% opaque for both iOS & Android Maskable)
    for y in range(size):
        # Vertical gradient interpolation
        t = y / float(size)
        r = int(11 * (1 - t) + 3 * t)
        g = int(18 * (1 - t) + 7 * t)
        b = int(38 * (1 - t) + 18 * t)
        draw.line([(0, y), (size, y)], fill=(r, g, b, 255))

    # 2. Radial Ambient Glow Layer
    glow_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_img)
    cx, cy = size // 2, int(220 * scale)

    # Concentric ambient glows
    glow_radius = int(180 * scale)
    for r in range(glow_radius, 0, -4):
        alpha = int(40 * (1 - (r / glow_radius) ** 1.5))
        glow_draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(16, 185, 129, alpha))

    # Electric cyan inner core glow
    core_radius = int(110 * scale)
    for r in range(core_radius, 0, -3):
        alpha = int(60 * (1 - (r / core_radius) ** 1.2))
        glow_draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(56, 189, 248, alpha))

    glow_img = glow_img.filter(ImageFilter.GaussianBlur(radius=int(12 * scale)))
    img = Image.alpha_composite(img, glow_img)
    draw = ImageDraw.Draw(img)

    # 3. Subtle Concentric Tech Rings (Fintech Precision Aesthetic)
    for ring_r in [190, 160, 130]:
        r_scaled = int(ring_r * scale)
        draw.ellipse(
            [cx - r_scaled, cy - r_scaled, cx + r_scaled, cy + r_scaled],
            outline=(99, 102, 241, 35),
            width=max(1, int(1.5 * scale))
        )

    # 4. Stylized 3D Shield / Vault Emblem
    # Let's draw the outer shield contour
    # Coordinates in 512 space:
    shield_pts = [
        (256, 95),   # Top center peak
        (370, 140),  # Top right shoulder
        (355, 260),  # Right waist
        (256, 340),  # Bottom center tip
        (157, 260),  # Left waist
        (142, 140)   # Top left shoulder
    ]
    scaled_shield = [(int(x * scale), int(y * scale)) for x, y in shield_pts]

    # Shield shadow for depth
    shadow_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow_img)
    shadow_pts = [(x, y + int(10 * scale)) for x, y in scaled_shield]
    shadow_draw.polygon(shadow_pts, fill=(0, 0, 0, 140))
    shadow_img = shadow_img.filter(ImageFilter.GaussianBlur(radius=int(8 * scale)))
    img = Image.alpha_composite(img, shadow_img)
    draw = ImageDraw.Draw(img)

    # Shield fill (Deep translucent glass)
    shield_fill_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    sfill_draw = ImageDraw.Draw(shield_fill_img)
    sfill_draw.polygon(scaled_shield, fill=(15, 23, 42, 220))
    img = Image.alpha_composite(img, shield_fill_img)
    draw = ImageDraw.Draw(img)

    # Shield border stroke (Gradient emulation)
    stroke_w = max(2, int(7 * scale))
    draw.line([scaled_shield[0], scaled_shield[1]], fill=(56, 189, 248, 255), width=stroke_w)
    draw.line([scaled_shield[1], scaled_shield[2]], fill=(99, 102, 241, 255), width=stroke_w)
    draw.line([scaled_shield[2], scaled_shield[3]], fill=(168, 85, 247, 255), width=stroke_w)
    draw.line([scaled_shield[3], scaled_shield[4]], fill=(16, 185, 129, 255), width=stroke_w)
    draw.line([scaled_shield[4], scaled_shield[5]], fill=(52, 211, 153, 255), width=stroke_w)
    draw.line([scaled_shield[5], scaled_shield[0]], fill=(56, 189, 248, 255), width=stroke_w)

    # 5. Central Dynamic Vault S-Curve & Currency Knot ($ & ៛ Hybrid)
    # Draw bold smooth curves representing 'S' and Wealth Flow
    curve_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    cdraw = ImageDraw.Draw(curve_img)
    
    # Upper loop of 'S'
    upper_s_bbox = [int(195 * scale), int(135 * scale), int(317 * scale), int(225 * scale)]
    cdraw.arc(upper_s_bbox, start=160, end=360, fill=(56, 189, 248, 255), width=int(14 * scale))
    
    # Connecting diagonal
    cdraw.line(
        [(int(315 * scale), int(180 * scale)), (int(197 * scale), int(255 * scale))],
        fill=(99, 102, 241, 255),
        width=int(14 * scale)
    )
    
    # Lower loop of 'S'
    lower_s_bbox = [int(195 * scale), int(210 * scale), int(317 * scale), int(300 * scale)]
    cdraw.arc(lower_s_bbox, start=0, end=200, fill=(52, 211, 153, 255), width=int(14 * scale))

    # Vertical currency axis line ($ spine)
    cdraw.line(
        [(int(256 * scale), int(120 * scale)), (int(256 * scale), int(315 * scale))],
        fill=(255, 255, 255, 200),
        width=int(4 * scale)
    )

    # Two prominent glowing core gemstones
    cdraw.ellipse(
        [int(308 * scale), int(140 * scale), int(326 * scale), int(158 * scale)],
        fill=(56, 189, 248, 255)
    )
    cdraw.ellipse(
        [int(186 * scale), int(280 * scale), int(204 * scale), int(298 * scale)],
        fill=(52, 211, 153, 255)
    )

    img = Image.alpha_composite(img, curve_img)
    draw = ImageDraw.Draw(img)

    # 6. Crisp Typography Badge: "saveCH"
    # Render typography clearly inside the safe zone (Y ~ 370..420 in 512 space)
    # Using crisp bitmap rendering for maximum sharpness
    text_y = int(372 * scale)
    
    # Try loading Arial or default font
    font = None
    try:
        font = ImageFont.truetype("arialbd.ttf", int(44 * scale))
    except Exception:
        try:
            font = ImageFont.truetype("DejaVuSans-Bold.ttf", int(44 * scale))
        except Exception:
            font = ImageFont.load_default()

    # Draw "save" in crisp white, "CH" in emerald-teal
    text_full = "saveCH"
    bbox = draw.textbbox((0, 0), text_full, font=font)
    tw = bbox[2] - bbox[0]
    start_x = (size - tw) // 2

    # Measure "save"
    save_bbox = draw.textbbox((0, 0), "save", font=font)
    save_w = save_bbox[2] - save_bbox[0]

    # Draw glow for text
    text_glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    tg_draw = ImageDraw.Draw(text_glow)
    tg_draw.text((start_x, text_y), "save", fill=(255, 255, 255, 120), font=font)
    tg_draw.text((start_x + save_w, text_y), "CH", fill=(52, 211, 153, 160), font=font)
    text_glow = text_glow.filter(ImageFilter.GaussianBlur(radius=int(3 * scale)))
    img = Image.alpha_composite(img, text_glow)
    draw = ImageDraw.Draw(img)

    # Sharp text on top
    draw.text((start_x, text_y), "save", fill=(255, 255, 255, 255), font=font)
    draw.text((start_x + save_w, text_y), "CH", fill=(52, 211, 153, 255), font=font)

    # Subtle bottom accent pill
    pill_w = int(60 * scale)
    pill_h = int(4 * scale)
    pill_x = (size - pill_w) // 2
    pill_y = int(430 * scale)
    draw.rounded_rectangle([pill_x, pill_y, pill_x + pill_w, pill_y + pill_h], radius=int(2 * scale), fill=(99, 102, 241, 200))

    return img

if __name__ == '__main__':
    print("Generating high-resolution PWA icons...")
    # 512x512 Master / Maskable / Any
    icon512 = create_savech_icon(512)
    icon512.save('assets/icon-512.png', 'PNG', optimize=True)
    print("Saved assets/icon-512.png (512x512, Full bleed)")

    # 192x192 Standard Android / Chrome
    icon192 = create_savech_icon(192)
    icon192.save('assets/icon-192.png', 'PNG', optimize=True)
    print("Saved assets/icon-192.png (192x192)")

    # 180x180 Apple Touch Icon (iOS Safari standard)
    icon180 = create_savech_icon(180)
    icon180.save('assets/apple-touch-icon.png', 'PNG', optimize=True)
    print("Saved assets/apple-touch-icon.png (180x180, iOS Opaque)")

    # 512x512 dedicated maskable
    icon512.save('assets/icon-maskable-512.png', 'PNG', optimize=True)
    print("Saved assets/icon-maskable-512.png")
    print("All icons generated successfully!")
