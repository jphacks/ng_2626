
"use strict";

// ========================================
// 1. HTML要素を取得
// ========================================

const canvas = document.getElementById("artCanvas");
const status = document.getElementById("status");
const motionReadout = document.getElementById("motionReadout");
// const startButton = document.getElementById("startButton");
const clearButton = document.getElementById("clearButton");
const correctButton = document.getElementById("correctButton");
const pauseButton = document.getElementById("pauseButton");
const promptButton = document.getElementById("promptButton");
const wordDisplay = document.getElementById("Word");


const ctx = canvas?.getContext("2d");
// 線の波打ちと残像を管理する
let waveStrength = 0;
let wavePhase = 0;

// 過去の軌跡を保存する透明キャンバス
const trailCanvas = document.createElement("canvas");
const trailCtx = trailCanvas.getContext("2d");

// 残像の消える速さ（大きいほど早く消える）
const trailFade = 0.005;
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
if (!motionReadout) missingElements.push("#motionReadout");
// if (!startButton) missingElements.push("#startButton");
if (!clearButton) missingElements.push("#clearButton");
if (!ctx) missingElements.push("Canvas 2D context");
if (!pauseButton) missingElements.push("#pauseButton");
if (!promptButton) missingElements.push("#promptButton");
if (!wordDisplay) missingElements.push("#Word");

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
let motionTrail = [];
const maxMotionTrailPoints = 500;

// 一時停止と交代の状態
let isPaused = false;
let currentPlayer = 0;      // 何人目か（0始まり）
let motionGranted = false;  // センサーの許可が取れたか

// お題
const promptWords = ["波", "風", "雨", "光", "影", "音", "夢", "花", "鳥", "月"];

promptButton.addEventListener("click", () => {
    const word = promptWords[Math.floor(Math.random() * promptWords.length)];
    wordDisplay.textContent = `お題：${word}`;
});

function drawMotionTrail() {
    if (motionTrail.length < 2) return;

    for (let i = 1; i < motionTrail.length; i++) {
        const progress = i / motionTrail.length;
        ctx.beginPath();
        ctx.moveTo(motionTrail[i - 1].x, motionTrail[i - 1].y);
        ctx.lineTo(motionTrail[i].x, motionTrail[i].y);
        ctx.strokeStyle = `rgba(82, 229, 255, ${progress * 0.22})`;
        ctx.lineWidth = 1;
        ctx.lineCap = "round";
        ctx.stroke();
    }
}

function getDeformedPoint(point, index, strokeIndex) {
    const phase = index * 0.25 + wavePhase + strokeIndex * 1.7;

    return {
        x: point.x + Math.sin(phase) * waveStrength,
        y: point.y + Math.cos(phase * 0.8) * waveStrength * 0.6
    };
}

function drawStrokeList(targetCtx, list, deform = false) {
    list.forEach((stroke, strokeIndex) => {
        targetCtx.beginPath();

        if (stroke.type === "tap") {
            const point = deform
                ? getDeformedPoint(
                    { x: stroke.x, y: stroke.y },
                    0,
                    strokeIndex
                )
                : { x: stroke.x, y: stroke.y };

            targetCtx.arc(
                point.x,
                point.y,
                stroke.radius,
                0,
                Math.PI * 2
            );

            targetCtx.strokeStyle = stroke.color;
            targetCtx.lineWidth = 6;
            targetCtx.stroke();
            return;
        }

        const points = stroke.points;
        if (!points || points.length === 0) return;

        const first = deform
            ? getDeformedPoint(points[0], 0, strokeIndex)
            : points[0];

        targetCtx.moveTo(first.x, first.y);

        for (let i = 1; i < points.length; i++) {
            const point = deform
                ? getDeformedPoint(points[i], i, strokeIndex)
                : points[i];

            targetCtx.lineTo(point.x, point.y);
        }

        if (stroke.closed) {
            targetCtx.closePath();
        }

        targetCtx.strokeStyle = stroke.color || "#52e5ff";
        targetCtx.fillStyle = stroke.color || "#52e5ff";
        targetCtx.lineWidth = stroke.width || 3;
        targetCtx.lineCap = "round";
        targetCtx.lineJoin = "round";

        if (points.length === 1) {
            targetCtx.arc(
                first.x,
                first.y,
                (stroke.width || 3) / 2,
                0,
                Math.PI * 2
            );
            targetCtx.fill();
        } else {
            targetCtx.stroke();
        }
    });
}

function renderStrokes(list = strokes) {
    // メインキャンバスを消去
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 過去の軌跡を表示
    ctx.drawImage(trailCanvas, 0, 0);

    // 現在の線・点を波打たせて描画
    ctx.save();
    ctx.globalAlpha = 1;
    drawStrokeList(ctx, list, true);
    ctx.restore();
}

function handleDeviceMotion(event) {
    const acceleration = event.accelerationIncludingGravity
        || event.acceleration;

    if (
        !acceleration ||
        acceleration.x == null ||
        acceleration.y == null
    ) {
        console.log("加速度データを取得できません");
        return;
    }

    if (previousMotion) {
        const dx = acceleration.x - previousMotion.x;
        const dy = acceleration.y - previousMotion.y;
        const magnitude = Math.hypot(dx, dy);

        // 振ったときの揺れを大きくする
        shakeOffsetX = Math.max(
            -25,
            Math.min(25, shakeOffsetX + dx * 3)
        );

        shakeOffsetY = Math.max(
            -25,
            Math.min(25, shakeOffsetY + dy * 3)
        );
        // 加速度の変化量から波の強さを計算

        waveStrength = Math.min(
            35,
            waveStrength + magnitude * 1.8
        );

        // 波の位相を進める
        wavePhase += magnitude * 0.25;

    }

    previousMotion = {
        x: acceleration.x,
        y: acceleration.y
    };
}

function animateShake() {
    // 波の揺れを徐々に弱める
    waveStrength *= 0.97;
    if (waveStrength < 0.05) {
        waveStrength = 0;
    }

    // 波を少しずつ進める
    wavePhase += 0.04;

    // 残像を少しずつ透明にする
    trailCtx.save();
    trailCtx.globalCompositeOperation = "lighter";
    trailCtx.fillStyle = `rgba(0, 0, 0, ${trailFade})`;
    trailCtx.fillRect(0, 0, trailCanvas.width, trailCanvas.height);
    trailCtx.fillRect(
        0,
        0,
        trailCanvas.width,
        trailCanvas.height
    );
    trailCtx.restore();

    // 波打った線を残像キャンバスへ追加
    if (waveStrength > 0.5) {
        trailCtx.save();
        trailCtx.globalAlpha = 0.35;
        drawStrokeList(trailCtx, strokes, true);
        trailCtx.restore();
    }

    renderStrokes();

    if (isStarted) {
        requestAnimationFrame(animateShake);
    }
}
async function enableMotionSensor() {
    if (!("DeviceMotionEvent" in window)) {
        console.warn("DeviceMotionEventに対応していません");
        return false;
    }

    try {
        // iOSなど、明示的な許可が必要なブラウザ
        if (
            typeof DeviceMotionEvent.requestPermission === "function"
        ) {
            const permission =
                await DeviceMotionEvent.requestPermission();

            if (permission !== "granted") {
                console.warn("モーションセンサーが許可されませんでした");
                return false;
            }
        }

        // 古いリスナーの重複登録を防ぐ
        window.removeEventListener(
            "devicemotion",
            handleDeviceMotion
        );

        previousMotion = null;

        window.addEventListener(
            "devicemotion",
            handleDeviceMotion
        );

        console.log("モーションセンサーのイベントを登録しました");
        return true;

    } catch (error) {
        console.error("センサーの初期化に失敗しました:", error);
        return false;
    }
}

    // 許可済みならセンサーを再開する
function startMotion() {
    if (!motionGranted) return;

    window.removeEventListener("devicemotion", handleDeviceMotion);
    previousMotion = null;
    window.addEventListener("devicemotion", handleDeviceMotion);
    motionReadout.textContent = "";
}

// センサーを止めて，揺れもリセットする
function stopMotion() {
    window.removeEventListener("devicemotion", handleDeviceMotion);
    previousMotion = null;
    waveStrength = 0;
    motionReadout.textContent = "一時停止中（センサー停止）";
}

// 今の人の色を返す
function getPlayerColor() {
    return colors[currentPlayer % colors.length];
}

// pointerIdごとに、各指の座標と色を記録する
const activeTouches = new Map();

// 色のセット（あとで中身を差し替えてください）
const colorSets = [
  ["#52e5ff", "#ff6bd6", "#ffe66d", "#7cff6b", "#b388ff"], // セット1：ネオン
  ["#ff3b3b", "#ff9f1c", "#ffe600", "#00e676", "#2979ff"], // セット2：ビビッド原色
  ["#ff4f8b", "#ff7a3d", "#c86bff", "#3dd9ff", "#3dffb0"], // セット3：トロピカル
  ["#00f5d4", "#00bbf9", "#9b5de5", "#f15bb5", "#fee440"], // セット4：ポップ
];

// ランダムに1セット選ぶ
const colors = colorSets[Math.floor(Math.random() * colorSets.length)];

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

    // 残像キャンバスも同じサイズにする
    trailCanvas.width = canvas.width;
    trailCanvas.height = canvas.height;

    renderStrokes();

}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ========================================
// 4. 起動と同時に描画を開始
// ========================================

let motionRequested = false;

function startInteraction() {
    if (isStarted) return;

    isStarted = true;
    status.textContent = "画面に触れて描こう";
    requestAnimationFrame(animateShake);

    console.log("OTOIRO：操作を開始しました");
}

async function requestMotionOnce() {
    if (motionRequested) return;
    motionRequested = true;

    motionGranted = await enableMotionSensor();
    if (!motionGranted) {
        motionReadout.textContent = "加速度センサーを利用できません";
    }
}

// 一時停止して次の人へ交代
function pauseDrawing() {
    if (isPaused) return;

    isPaused = true;
    activeTouches.clear();
    stopMotion();

    currentPlayer++;
    pauseButton.disabled = true;
    status.textContent =
        `${currentPlayer + 1}人目の番です．画面に触れると描き始めます`;
}

// 次の人が触れたら再開
function resumeDrawing() {
    isPaused = false;
    startMotion();
    pauseButton.disabled = false;
}

pauseButton.addEventListener("click", pauseDrawing);

startInteraction();

// ========================================
// 5. 指が触れたとき
// ========================================

canvas.addEventListener("pointerdown", (event) => {
    console.log("pointerdown:", event.pointerType, event.pointerId);

/*    if (!isStarted) {
        status.textContent = "先に開始ボタンを押してください";
        return;
    }
*/

    if (event.pointerType === "mouse" && event.button !== 0) {
        return;
    }

    event.preventDefault();

    // 一時停止中なら，このタッチで再開する
    if (isPaused) {
        resumeDrawing();
    }

    const pos = fn.getPosition(event, canvas);
    const color = getPlayerColor();   // 指の本数ではなく人で決める

    activeTouches.set(event.pointerId, {
        startX: pos.x,
        startY: pos.y,
        x: pos.x,
        y: pos.y,
        color,
        player: currentPlayer,        // 追加
        moved: false,
        stroke: {
            points: [{ x: pos.x, y: pos.y }],
            color,
            player: currentPlayer,    // 追加
            width: 8,
            closed: false
        }
    });

    // キャンバスの外へ指が動いても追跡する
    canvas.setPointerCapture(event.pointerId);


    const count = activeTouches.size;
    fn.updateStatus(status, count);
    status.textContent = "タップ判定中";
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
    const dx = pos.x - touch.startX;
    const dy = pos.y - touch.startY;
    const distance = Math.hypot(dx, dy);

    if (!touch.moved) {
        if (distance <= 8) return;

        touch.moved = true;
        strokes.push(touch.stroke);
        status.textContent = "スワイプ中";
    }

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
    const touch = activeTouches.get(event.pointerId);
    if (!touch) return;

    // 最初に指を離したときにセンサーの許可を求める
    if (event.type === "pointerup") {
        requestMotionOnce();
    }

    if (event.type === "pointerup" && !touch.moved) {
        strokes.push({
            type: "tap",
            x: touch.startX,
            y: touch.startY,
            radius: 5 + Math.random() * 20,
            color: touch.color,
            player: touch.player
        });
    }

    activeTouches.delete(event.pointerId);
    renderStrokes();
    fn.updateStatus(status, activeTouches.size);
    if (event.type === "pointerup") {
        status.textContent = touch.moved ? "スワイプしました" : "タップしました";
    } else {
        status.textContent = "操作がキャンセルされました";
    }

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
    status.textContent = "画面をリセットしました";
    console.log("OTOIRO：画面をリセットしました");

    strokes = [];
    originalStrokes = [];
    activeTouches.clear();
    trailCtx.clearRect(
        0,
        0,
        trailCanvas.width,
        trailCanvas.height
    );

    waveStrength = 0;
    wavePhase = 0;

    shakeOffsetX = 0;
    shakeOffsetY = 0;
    previousMotion = null;
    wordDisplay.textContent = "";
    // 1人目からやり直す
    currentPlayer = 0;
    isPaused = false;
    pauseButton.disabled = false;
    startMotion();
    renderStrokes();
});

console.log("OTOIRO：JavaScriptの読み込み完了");


