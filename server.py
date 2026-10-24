
from pathlib import Path
from math import hypot, cos, sin, pi, sqrt
from statistics import pstdev

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from io import BytesIO
import base64

from PIL import Image, ImageDraw, ImageFilter
from fastapi import Body

# pythonの仮の処理，後にAIを使った処理に置き換える，加える予定

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title="OTOIRO shape refinement")
@app.get("/api/health")
async def health():
    return {"ok": True}
from math import hypot, sin, cos, pi


def is_closed(points):
    """始点と終点が近い場合は閉じた線と判定する。"""
    if len(points) < 8:
        return False

    xs = [p["x"] for p in points]
    ys = [p["y"] for p in points]
    diagonal = hypot(max(xs) - min(xs), max(ys) - min(ys))

    if diagonal < 10:
        return False

    distance = hypot(
        points[0]["x"] - points[-1]["x"],
        points[0]["y"] - points[-1]["y"],
    )

    return distance < max(12, diagonal * 0.08)


def chaikin_smooth(points, iterations=2, closed=False):
    """Chaikin曲線で角を丸める。"""
    if len(points) < 3:
        return points[:]

    result = points[:]

    for _ in range(iterations):
        new_points = []

        if not closed:
            # 開いた線では始点・終点を維持する
            new_points.append(result[0])

        limit = len(result) if closed else len(result) - 1

        for i in range(limit):
            p = result[i]
            q = result[(i + 1) % len(result)]

            new_points.append({
                "x": 0.75 * p["x"] + 0.25 * q["x"],
                "y": 0.75 * p["y"] + 0.25 * q["y"],
            })
            new_points.append({
                "x": 0.25 * p["x"] + 0.75 * q["x"],
                "y": 0.25 * p["y"] + 0.75 * q["y"],
            })

        if not closed:
            new_points.append(result[-1])

        result = new_points

    return result


def resample_points(points, spacing=4.0, closed=False):
    """線に沿った点の間隔をおおむね均一にする。"""
    if len(points) < 2:
        return points[:]

    result = [points[0]]
    distance_to_next = spacing

    for i in range(1, len(points)):
        start = points[i - 1]
        end = points[i]

        dx = end["x"] - start["x"]
        dy = end["y"] - start["y"]
        length = hypot(dx, dy)

        if length < 1e-6:
            continue

        travelled = 0.0

        while travelled + distance_to_next <= length:
            travelled += distance_to_next
            ratio = travelled / length

            result.append({
                "x": start["x"] + dx * ratio,
                "y": start["y"] + dy * ratio,
            })
            distance_to_next = spacing

        distance_to_next -= length - travelled

        if distance_to_next <= 1e-6:
            distance_to_next = spacing

    if not closed and result[-1] != points[-1]:
        result.append(points[-1])

    return result


def marble_points(points, closed=False, strength=0.035):
    """
    線の形を残しながら、低周波の横揺れを加える。
    strengthは線の大きさに対する変位の割合。
    """
    if len(points) < 5:
        return points[:]

    xs = [p["x"] for p in points]
    ys = [p["y"] for p in points]
    diagonal = hypot(max(xs) - min(xs), max(ys) - min(ys))

    if diagonal < 1:
        return points[:]

    amplitude = min(12.0, diagonal * strength)

    # 累積距離を計算
    distances = [0.0]
    for i in range(1, len(points)):
        dx = points[i]["x"] - points[i - 1]["x"]
        dy = points[i]["y"] - points[i - 1]["y"]
        distances.append(distances[-1] + hypot(dx, dy))

    total_length = distances[-1]
    if total_length < 1e-6:
        return points[:]

    result = []

    for i, p in enumerate(points):
        prev_p = points[max(0, i - 1)]
        next_p = points[min(len(points) - 1, i + 1)]

        # 接線方向を求め、そこから垂直な方向へ変位させる
        tx = next_p["x"] - prev_p["x"]
        ty = next_p["y"] - prev_p["y"]
        tangent_length = hypot(tx, ty)

        if tangent_length < 1e-6:
            result.append(p.copy())
            continue

        nx = -ty / tangent_length
        ny = tx / tangent_length

        s = distances[i] / total_length

        # 低周波を複数重ねて、規則的すぎない流れを作る
        offset = amplitude * (
            0.65 * sin(2 * pi * 1.5 * s)
            + 0.25 * sin(2 * pi * 2.7 * s + 1.2)
            + 0.10 * sin(2 * pi * 4.1 * s + 2.1)
        )

        # 開いた線の端は動かさず、自然につなぐ
        if not closed:
            envelope = sin(pi * s) ** 0.5
            offset *= envelope

        result.append({
            "x": p["x"] + nx * offset,
            "y": p["y"] + ny * offset,
        })

    return result

def refine_stroke(stroke):
    points = stroke.get("points", [])
    points = stroke.get("points", [])

    if not isinstance(points, list) or len(points) == 0:
        return None
        
    try:
        clean = [
            {"x": float(p["x"]), "y": float(p["y"])}
            for p in points
            if isinstance(p, dict)
            and "x" in p and "y" in p
        ]
    except (TypeError, ValueError):
        return None

    if not clean:
        return None

    # タップなどの短いストロークは形を変えずに保持
    if len(clean) < 5:
        return {
            **stroke,
            "points": clean,
            "kind": stroke.get("kind", "original"),
        }

    # ここから下は、既存の補正処理を続ける
    closed = is_closed(clean)
    if not isinstance(points, list) or len(points) < 2:
        return None

    try:
        clean = [
            {"x": float(p["x"]), "y": float(p["y"])}
            for p in points
            if isinstance(p, dict)
            and "x" in p and "y" in p
        ]
    except (TypeError, ValueError):
        return None

    if len(clean) < 2:
        return None

    closed = is_closed(clean)

    # 角を丸める → 点の間隔を均一化 → マーブリング状に変形
    smoothed = chaikin_smooth(
        clean,
        iterations=2,
        closed=closed,
    )
    sampled = resample_points(
        smoothed,
        spacing=4.0,
        closed=closed,
    )
    refined_points = marble_points(
        sampled,
        closed=closed,
        strength=0.035,
    )

    return {
        "points": refined_points,
        "color": str(stroke.get("color", "#52e5ff")),
        "width": float(stroke.get("width", 3)),
        "closed": closed,
        "kind": "marbled",
    }
def render_ink_image(strokes, width, height):
    """線を画像化し、にじみ・ぼかし・色の重なりを作る。"""

    width = max(1, min(int(width), 2048))
    height = max(1, min(int(height), 2048))

    # 線を描くための透明な画像
    base = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(base)

    for stroke in strokes:
        if not isinstance(stroke, dict):
            continue

        color = stroke.get("color", "#52e5ff")

        # 色を安全に読み込む
        try:
            ink = Image.new("RGB", (1, 1), color).getpixel((0, 0))
        except (ValueError, TypeError):
            ink = (82, 229, 255)

        try:
            line_width = max(1, min(int(float(stroke.get("width", 3))), 100))
        except (ValueError, TypeError):
            line_width = 3

        # タップによる円も、線とは別に正しく描く
        if stroke.get("type") == "tap":
            try:
                x = float(stroke["x"])
                y = float(stroke["y"])
                radius = max(1, min(float(stroke.get("radius", 3)), 200))
            except (KeyError, ValueError, TypeError):
                continue

            draw.ellipse(
                (x - radius, y - radius, x + radius, y + radius),
                fill=(*ink, 220),
            )
            continue

        points = stroke.get("points", [])

        if not isinstance(points, list) or not points:
            continue

        try:
            coords = [
                (float(p["x"]), float(p["y"]))
                for p in points
                if isinstance(p, dict) and "x" in p and "y" in p
            ]
        except (ValueError, TypeError):
            continue

        if not coords:
            continue

        if len(coords) == 1:
            x, y = coords[0]
            r = line_width / 2
            draw.ellipse(
                (x - r, y - r, x + r, y + r),
                fill=(*ink, 220),
            )
        else:
            draw.line(
                coords,
                fill=(*ink, 220),
                width=line_width,
                joint="curve",
            )

            # 丸い線端を補う
            r = line_width / 2
            for x, y in (coords[0], coords[-1]):
                draw.ellipse(
                    (x - r, y - r, x + r, y + r),
                    fill=(*ink, 220),
                )

    # ぼかしを複数段階で作る
    soft = base.filter(ImageFilter.GaussianBlur(radius=12))
    medium = base.filter(ImageFilter.GaussianBlur(radius=5))

    # にじみを薄くする
    soft.putalpha(
        soft.getchannel("A").point(lambda a: int(a * 0.65))
    )
    medium.putalpha(
        medium.getchannel("A").point(lambda a: int(a * 0.45))
    )

    # にじみ → 中間のぼかし → 元の線の順に重ねる
    result = Image.alpha_composite(soft, medium)
    result = Image.alpha_composite(result, base)

    buffer = BytesIO()
    result.save(buffer, format="PNG")

    return base64.b64encode(buffer.getvalue()).decode("ascii")
@app.post("/api/refine")
async def refine(payload: dict):
    strokes = payload.get("strokes", [])

    if not isinstance(strokes, list):
        raise HTTPException(status_code=400, detail="strokes must be a list")

    if len(strokes) > 500:
        raise HTTPException(status_code=413, detail="Too many strokes")

    result = []

    for stroke in strokes:
        if not isinstance(stroke, dict):
            continue

        refined = refine_stroke(stroke)
        if refined:
            result.append(refined)

    circle_count = sum(
        1 for stroke in result if stroke["kind"] == "circle"
    )

    return {
        "strokes": result,
        "message": (
            f"円を{circle_count}個推定し、"
            f"全{len(result)}本の線を処理しました"
        ),
    }


@app.post("/api/render")
async def render(payload: dict = Body(...)):
    strokes = payload.get("strokes", [])

    if not isinstance(strokes, list):
        raise HTTPException(
            status_code=400,
            detail="strokes must be a list",
        )

    if len(strokes) > 500:
        raise HTTPException(
            status_code=413,
            detail="Too many strokes",
        )

    try:
        width = int(payload.get("width", 800))
        height = int(payload.get("height", 600))

        image_data = render_ink_image(strokes, width, height)

    except (ValueError, TypeError):
        raise HTTPException(
            status_code=400,
            detail="Invalid image dimensions",
        )

    return {
        "image": "data:image/png;base64," + image_data
    }


# APIを定義した後で、HTML・CSS・JavaScriptを配信する
app.mount(
    "/",
    StaticFiles(directory=str(BASE_DIR), html=True),
    name="static",
)
