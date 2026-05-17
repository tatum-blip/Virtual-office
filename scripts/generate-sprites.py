"""
Generate placeholder sprite sheets as minimal valid PNGs.
No dependencies — uses only Python stdlib.

Outputs:
  public/assets/sprites/agent-creatures.png  (8 creatures × 4 frames = 32 cols, 32px each = 1024×32)
  public/assets/sprites/avatars.png          (8 avatars × 4 frames = 32 cols, 32×48 each = 1024×48)
  public/assets/tilemaps/tileset.png         (simple 32×32 tile sheet)
"""
import struct
import zlib
import os

ROOT = os.path.join(os.path.dirname(__file__), '..')

CREATURE_COLORS = [
    (249, 115, 22),   # marketing  - orange
    (20, 184, 166),   # sales      - teal
    (99, 102, 241),   # engineering - indigo
    (236, 72, 153),   # design     - pink
    (139, 92, 246),   # product    - violet
    (234, 179, 8),    # testing    - yellow
    (34, 197, 94),    # support    - green
    (6, 182, 212),    # finance    - cyan
]

AVATAR_COLORS = [
    (249, 115, 22), (20, 184, 166), (99, 102, 241), (236, 72, 153),
    (139, 92, 246), (234, 179, 8),  (34, 197, 94),  (6, 182, 212),
]

def make_png(width: int, height: int, pixels: list[list[tuple[int,int,int,int]]]) -> bytes:
    """Create a minimal RGBA PNG from a 2D list of (R,G,B,A) tuples."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        c = struct.pack('>I', len(data)) + tag + data
        c += struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
        return c

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    # Use RGB (color type 2) instead of RGBA for simplicity
    ihdr = struct.pack('>II', width, height) + bytes([8, 6, 0, 0, 0])  # RGBA

    raw_rows = []
    for row in pixels:
        row_bytes = b'\x00'  # filter type None
        for r, g, b, a in row:
            row_bytes += bytes([r, g, b, a])
        raw_rows.append(row_bytes)

    compressed = zlib.compress(b''.join(raw_rows), 9)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', compressed)
    png += chunk(b'IEND', b'')
    return png

def draw_creature(w: int, h: int, color: tuple[int,int,int], frame: int) -> list[list[tuple[int,int,int,int]]]:
    """Draw a simple creature frame (blob shape with eyes)."""
    r, g, b = color
    pixels = [[(0, 0, 0, 0)] * w for _ in range(h)]

    # Body circle (centered, 80% of frame)
    cx, cy = w // 2, h // 2
    body_r = min(w, h) * 0.38

    # Walk offset for animation
    walk_offset = [0, -1, 0, 1][frame % 4]

    for y in range(h):
        for x in range(w):
            dx = x - cx
            dy = y - (cy + walk_offset)
            if dx*dx + dy*dy <= body_r*body_r:
                # Slight shade variation
                shade = int(max(0, 1 - (dx*dx + dy*dy) / (body_r*body_r)) * 40)
                pixels[y][x] = (min(255, r + shade), min(255, g + shade), min(255, b + shade), 255)

    # Eyes (2 white dots with pupils)
    for ex, ey in [(cx - w//6, cy - h//8 + walk_offset), (cx + w//6, cy - h//8 + walk_offset)]:
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                nx, ny = ex + dx, ey + dy
                if 0 <= nx < w and 0 <= ny < h:
                    if dx*dx + dy*dy <= 4:
                        pixels[ny][nx] = (255, 255, 255, 255)
        # Pupil
        if 0 <= ex < w and 0 <= ey < h:
            pixels[ey][ex] = (20, 20, 40, 255)

    return pixels

def draw_avatar(w: int, h: int, color: tuple[int,int,int], frame: int) -> list[list[tuple[int,int,int,int]]]:
    """Draw a simple human avatar (body + head)."""
    r, g, b = color
    pixels = [[(0, 0, 0, 0)] * w for _ in range(h)]

    walk_offset = [0, -1, 0, 1][frame % 4]
    cx = w // 2

    # Head
    head_cx, head_cy = cx, h // 4 + walk_offset
    head_r = w * 0.22
    for y in range(h):
        for x in range(w):
            dx = x - head_cx
            dy = y - head_cy
            if dx*dx + dy*dy <= head_r*head_r:
                pixels[y][x] = (min(255, r+30), min(255, g+30), min(255, b+30), 255)

    # Body
    body_top = int(h * 0.38) + walk_offset
    body_bot = int(h * 0.72) + walk_offset
    body_left = cx - int(w * 0.25)
    body_right = cx + int(w * 0.25)
    for y in range(max(0, body_top), min(h, body_bot)):
        for x in range(max(0, body_left), min(w, body_right)):
            pixels[y][x] = (r, g, b, 255)

    # Legs
    leg_offset = [0, 2, 0, -2][frame % 4]
    for lx in [cx - int(w*0.1), cx + int(w*0.1)]:
        leg_bot = int(h * 0.95) + (leg_offset if lx < cx else -leg_offset)
        for y in range(min(h, body_bot), min(h, leg_bot)):
            if 0 <= lx < w:
                pixels[y][lx] = (max(0, r-40), max(0, g-40), max(0, b-40), 255)

    return pixels

def generate_spritesheet(frame_w: int, frame_h: int, num_creatures: int, num_frames: int,
                          colors: list[tuple[int,int,int]], drawer, path: str):
    total_w = frame_w * num_frames * num_creatures
    total_h = frame_h
    all_pixels = [[(0,0,0,0)] * total_w for _ in range(total_h)]

    for ci, color in enumerate(colors[:num_creatures]):
        for fi in range(num_frames):
            frame = drawer(frame_w, frame_h, color, fi)
            col_offset = (ci * num_frames + fi) * frame_w
            for y in range(frame_h):
                for x in range(frame_w):
                    all_pixels[y][col_offset + x] = frame[y][x]

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(make_png(total_w, total_h, all_pixels))
    print(f'Generated {path}  ({total_w}×{total_h})')

def generate_tileset(path: str):
    """Simple 2-tile tileset: tile 0 = floor, tile 1 = wall."""
    w, h = 64, 32  # 2 tiles wide × 32px each
    pixels = [[(0,0,0,0)] * w for _ in range(h)]

    # Tile 0: floor (dark blue-grey)
    for y in range(h):
        for x in range(32):
            if (x + y) % 4 < 2:
                pixels[y][x] = (35, 38, 60, 255)
            else:
                pixels[y][x] = (40, 44, 70, 255)

    # Tile 1: wall (darker)
    for y in range(h):
        for x in range(32, 64):
            pixels[y][x] = (20, 22, 40, 255)

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(make_png(w, h, pixels))
    print(f'Generated {path}  ({w}×{h})')

if __name__ == '__main__':
    sprites_dir = os.path.join(ROOT, 'public', 'assets', 'sprites')
    tilemaps_dir = os.path.join(ROOT, 'public', 'assets', 'tilemaps')

    generate_spritesheet(
        32, 32, 8, 4, CREATURE_COLORS, draw_creature,
        os.path.join(sprites_dir, 'agent-creatures.png')
    )
    generate_spritesheet(
        32, 48, 8, 4, AVATAR_COLORS, draw_avatar,
        os.path.join(tilemaps_dir, '../sprites/avatars.png')
    )
    generate_tileset(os.path.join(tilemaps_dir, 'tileset.png'))
    print('Done.')
