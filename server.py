
from pathlib import Path
from math import hypot, cos, sin, pi, sqrt
from statistics import pstdev

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

# pythonの仮の処理，後にAIを使った処理に置き換える，加える予定

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title="OTOIRO shape refinement")
@app.get("/api/health")
async def health():
    return {"ok": True}

def smooth_points(points, radius=2):
    """近傍の座標を平均して線を滑らかにする。"""
    if len(points) < 3:
        return points

    result = []

    for i, point in enumerate(points):
        start = max(0, i - radius)
        end = min(len(points), i + radius + 1)
        nearby = points[start:end]

        result.append({
            "x": sum(p["x"] for p in nearby) / len(nearby),
            "y": sum(p["y"] for p in nearby) / len(nearby),
        })

    return result


def detect_circle(points):
    """閉じた線が円に近いか、簡易的に推定する。"""
    if len(points) < 8:
        return None

    first, last = points[0], points[-1]
    xs = [p["x"] for p in points]
    ys = [p["y"] for p in points]

    width = max(xs) - min(xs)
    height = max(ys) - min(ys)
    diagonal = hypot(width, height)

    if diagonal < 10:
        return None

    endpoint_distance = hypot(
        first["x"] - last["x"],
        first["y"] - last["y"],
    )

    # 始点と終点が近くなければ、閉じた形とはみなさない
    if endpoint_distance > max(12, diagonal * 0.12):
        return None

    # 細長い形は円とみなさない
    if min(width, height) <= 0:
        return None

    aspect_ratio = width / height
    if not 0.75 <= aspect_ratio <= 1.33:
        return None

    # 始点と終点の重複による偏りを抑える
    sample = points[:-1] if endpoint_distance < 1 else points

    cx = sum(p["x"] for p in sample) / len(sample)
    cy = sum(p["y"] for p in sample) / len(sample)

    distances = [
        hypot(p["x"] - cx, p["y"] - cy)
        for p in sample
    ]

    mean_radius = sum(distances) / len(distances)
    if mean_radius < 5:
        return None

    variation = pstdev(distances) / mean_radius

    # 半径のばらつきが小さいほど円らしい
    if variation > 0.18:
        return None

    return {
        "cx": cx,
        "cy": cy,
        "radius": mean_radius,
    }


def refine_stroke(stroke):
    points = stroke.get("points", [])

    if not isinstance(points, list) or len(points) == 0:
        return None

    # 数値として扱える座標だけを受け付ける
    try:
        clean = [
            {"x": float(p["x"]), "y": float(p["y"])}
            for p in points
        ]
    except (KeyError, TypeError, ValueError):
        return None

    circle = detect_circle(clean)

    if circle:
        # 推定した円を64点で描き直す
        cx, cy, radius = (
            circle["cx"],
            circle["cy"],
            circle["radius"],
        )

        refined_points = [
            {
                "x": cx + radius * cos(2 * pi * i / 64),
                "y": cy + radius * sin(2 * pi * i / 64),
            }
            for i in range(65)
        ]

        kind = "circle"
        closed = True
    else:
        refined_points = smooth_points(clean)
        kind = "smooth-line"
        closed = False

    return {
        "points": refined_points,
        "color": str(stroke.get("color", "#52e5ff")),
        "width": 3,
        "closed": closed,
        "kind": kind,
    }


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


# APIを定義した後で、HTML・CSS・JavaScriptを配信する
app.mount(
    "/",
    StaticFiles(directory=str(BASE_DIR), html=True),
    name="static",
)
