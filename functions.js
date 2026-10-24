

window.OTOIROFunctions = {
  // キャンバスの大きさを調整する
  resizeCanvas(canvas, ctx) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    // CSS上の座標と描画座標を合わせる
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },

  // イベントの座標をキャンバス内の座標に変換する
  getPosition(event, canvas) {
    const rect = canvas.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  },

  // タップ位置に波紋を描く
  drawRipple(ctx, x, y, color) {
    ctx.beginPath();
    ctx.arc(x, y, 100, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
  },

  // 音を鳴らす
  playSound(audioState, fingerCount) {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      console.warn("このブラウザはWeb Audio APIに対応していません");
      return;
    }

    if (!audioState.context) {
      audioState.context = new AudioContextClass();
    }

    const audio = audioState.context;

    if (audio.state === "suspended") {
      audio.resume();
    }

    const oscillator = audio.createOscillator();
    const gain = audio.createGain();

    const frequencies = {
      1: 440,
      2: 554,
      3: 659
    };

    oscillator.type = "sine";
    oscillator.frequency.value =
      frequencies[Math.min(fingerCount, 3)] || 440;

    gain.gain.setValueAtTime(0.12, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      audio.currentTime + 0.25
    );

    oscillator.connect(gain);
    gain.connect(audio.destination);

    oscillator.start();
    oscillator.stop(audio.currentTime + 0.25);
  },

  // 指の本数を画面に表示する
  updateStatus(status, count) {
    if (count === 0) {
      status.textContent = "画面に触れて始めよう";
    } else {
      status.textContent = `${count}本の指で操作中`;
    }
  }
};
