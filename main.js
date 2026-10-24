
"use strict";

// ========================================
// 1. HTML要素を取得
// ========================================

const canvas = document.getElementById("artCanvas");
const status = document.getElementById("status");
const startButton = document.getElementById("startButton");
const clearButton = document.getElementById("clearButton");
const correctButton = document.getElementById("correctButton");

const ctx = canvas?.getContext("2d");
//pythonサーバーの状態を取得
let serverAvailable = false;

correctButton.disabled = true;
correctButton.textContent = "補正サーバー未接続";

async function checkPythonServer() {
    // index.htmlを直接開いた場合は描画専用モード
    if (location.protocol === "file:") {
        serverAvailable = false;
        correctButton.disabled = true;
        correctButton.textContent = "補正にはサーバーが必要";
        return;
    }

    try {
        const response = await fetch("/api/health", {
            signal: AbortSignal.timeout(2000)
        });

        if (!response.ok) {
            throw new Error("サーバー応答エラー");
        }

        const data = await response.json();
        serverAvailable = data.ok === true;
    } catch {
        serverAvailable = false;
    }

    correctButton.disabled = !serverAvailable;
    correctButton.textContent = serverAvailable
        ? "形状を補正"
        : "補正サーバー未接続";
}

// 起動時に確認し、その後も定期的に確認
checkPythonServer();
setInterval(checkPythonServer, 5000);

// 必須要素が取得できなければ、ここで原因を表示する
const missingElements = [];

if (!canvas) missingElements.push("#artCanvas");
if (!status) missingElements.push("#status");
if (!startButton) missingElements.push("#startButton");
if (!clearButton) missingElements.push("#clearButton");
if (!ctx) missingElements.push("Canvas 2D context");

if (missingElements.length > 0) {
    console.error(
        "OTOIRO：HTML要素が見つかりません:",
        missingElements.join(", ")
    );
    throw new Error("HTMLのIDとJavaScriptを確認してください");
}

// ========================================
// 2. 状態を管理
// ========================================

let isStarted = false;
let strokes = [];
let originalStrokes = [];

let shakeOffsetX = 0;
let shakeOffsetY = 0;
let previousMotion = null;

function renderStrokes(list = strokes) {
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.save();
    ctx.translate(shakeOffsetX, shakeOffsetY);

    for (const stroke of list) {
        const points = stroke.points;
        if (!points || points.length === 0) continue;

        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);

        if (points.length === 1) {
            ctx.arc(points[0].x, points[0].y, (stroke.width || 3) / 2, 0, Math.PI * 2);
        } else {
            for (let i = 1; i < points.length; i++) {
                ctx.lineTo(points[i].x, points[i].y);
            }
            if (stroke.closed) ctx.closePath();
        }

        ctx.strokeStyle = stroke.color || "#52e5ff";
        ctx.fillStyle = stroke.color || "#52e5ff";
        ctx.lineWidth = stroke.width || 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        if (points.length === 1) ctx.fill();
        else ctx.stroke();
    }

    ctx.restore();
}

function handleDeviceMotion(event) {
    const acceleration = event.accelerationIncludingGravity;
    if (!acceleration || acceleration.x == null || acceleration.y == null) return;

    if (previousMotion) {
        const dx = acceleration.x - previousMotion.x;
        const dy = acceleration.y - previousMotion.y;
        shakeOffsetX = Math.max(-18, Math.min(18, dx * 2.5));
        shakeOffsetY = Math.max(-18, Math.min(18, dy * 2.5));
    }

    previousMotion = { x: acceleration.x, y: acceleration.y };
}

function animateShake() {
    shakeOffsetX *= 0.82;
    shakeOffsetY *= 0.82;
    renderStrokes();
    if (isStarted) requestAnimationFrame(animateShake);
}

async function enableMotionSensor() {
    if (!("DeviceMotionEvent" in window)) return false;

    try {
        if (typeof DeviceMotionEvent.requestPermission === "function") {
            const permission = await DeviceMotionEvent.requestPermission();
            if (permission !== "granted") return false;
        }

        window.addEventListener("devicemotion", handleDeviceMotion);
        return true;
    } catch (error) {
        console.warn("端末の動きを取得できませんでした:", error);
        return false;
    }
}

// pointerIdごとに、各指の座標と色を記録する
const activeTouches = new Map();

const colors = ["#52e5ff", "#ff6bd6", "#ffe66d"];

// 音声の状態を保存する
const audioState = {
    context: null
};

// 関数を短く呼び出せるようにする
const fn = window.OTOIROFunctions;

if (!fn) {
    throw new Error("functions.jsが読み込まれていません");
}

// ========================================
// 3. キャンバスの準備
// ========================================

function resizeCanvas() {
    fn.resizeCanvas(canvas, ctx);
    renderStrokes();
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ========================================
// 4. 開始ボタン
// ========================================

async function startInteraction() {
    if (isStarted) return;

    const motionEnabled = await enableMotionSensor();
    isStarted = true;
    status.textContent = motionEnabled
        ? "画面に触れて描こう。端末を振ると線が揺れます"
        : "画面に触れて始めよう（振る操作は利用できません）";

    startButton.textContent = "操作中";
    startButton.disabled = true;
    requestAnimationFrame(animateShake);

    console.log("OTOIRO：操作を開始しました");
}

startButton.addEventListener("click", startInteraction);

// ========================================
// 5. 指が触れたとき
// ========================================

canvas.addEventListener("pointerdown", (event) => {
    console.log("pointerdown:", event.pointerType, event.pointerId);

    if (!isStarted) {
        status.textContent = "先に開始ボタンを押してください";
        return;
    }

    if (event.pointerType === "mouse" && event.button !== 0) {
        return;
    }

    event.preventDefault();

    const pos = fn.getPosition(event, canvas);
    const color = colors[activeTouches.size % colors.length];

    const stroke = {
        points: [{ x: pos.x, y: pos.y }],
        color,
        width: 3,
        closed: false
    };
    strokes.push(stroke);

    activeTouches.set(event.pointerId, {
        x: pos.x,
        y: pos.y,
        color: color,
        stroke
    });

    // キャンバスの外へ指が動いても追跡する
    canvas.setPointerCapture(event.pointerId);

    fn.drawRipple(ctx, pos.x, pos.y, color);

    const count = activeTouches.size;
    fn.updateStatus(status, count);
    fn.playSound(audioState, count);
});

// ========================================
// 6. 指が動いたとき
// ========================================

canvas.addEventListener("pointermove", (event) => {
    const touch = activeTouches.get(event.pointerId);


    if (!touch) return;

    event.preventDefault();

    const pos = fn.getPosition(event, canvas);

    ctx.beginPath();
    ctx.moveTo(touch.x, touch.y);
    ctx.lineTo(pos.x, pos.y);

    ctx.strokeStyle = touch.color;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.stroke();

    // 描いた座標を補正用に保存
    touch.stroke.points.push({ x: pos.x, y: pos.y });

    // 次の描画に備えて座標を更新
    touch.x = pos.x;
    touch.y = pos.y;
});

// ========================================
// 7. 指を離したとき
// ========================================

function endTouch(event) {
    if (!activeTouches.has(event.pointerId)) return;

    activeTouches.delete(event.pointerId);
    fn.updateStatus(status, activeTouches.size);

    console.log("指を離しました。残り:", activeTouches.size);
}

canvas.addEventListener("pointerup", endTouch);
canvas.addEventListener("pointercancel", endTouch);
// ========================================
// 8. pythonサーバに補正依頼
// ========================================

correctButton.addEventListener("click", async () => {
    if (!serverAvailable) {
        status.textContent = "Pythonサーバーを起動してください";
        return;
    }
    if (strokes.length === 0) {
        status.textContent = "先にキャンバスに描いてください";
        return;
    }

    // 指で描いている途中の線があれば補正前に終了扱いにする
    activeTouches.clear();

    // 元の作品を保存しておく
    originalStrokes = JSON.parse(JSON.stringify(strokes));

    correctButton.disabled = true;
    status.textContent = "形状を解析・補正しています...";

    try {
        const response = await fetch("/api/refine", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                width: canvas.clientWidth,
                height: canvas.clientHeight,
                strokes
            })
        });

        if (!response.ok) {
            throw new Error(`サーバーエラー: ${response.status}`);
        }

        const result = await response.json();

        strokes = result.strokes;
        renderStrokes(strokes);

        status.textContent =
            `補正完了：${result.message || "形状を整えました"}`;
    } catch (error) {
        console.error(error);
        status.textContent =
            "補正できませんでした。Pythonサーバーを確認してください";
    } finally {
        correctButton.disabled = false;
    }
});



// ========================================
// 9. リセットボタン
// ========================================

clearButton.addEventListener("click", () => {
    const rect = canvas.getBoundingClientRect();

    ctx.clearRect(0, 0, rect.width, rect.height);

    status.textContent = "画面をリセットしました";
    console.log("OTOIRO：画面をリセットしました");

    strokes = [];
    originalStrokes = [];
    activeTouches.clear();
});

console.log("OTOIRO：JavaScriptの読み込み完了");

