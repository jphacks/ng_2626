

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
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 7;
    ctx.stroke();
  },

  // タップ位置にランダムな大きさの円を描く
  drawRipple(ctx, x, y, color) {
    const radius = 5 + Math.random() * 20;
    // 半径は5〜25pxのランダムな値

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.stroke();
  },

  // 音を鳴らす
  // 音を鳴らす
  async playSound(audioState, fingerCount, volume = 0.15) {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      console.warn("このブラウザはWeb Audio APIに対応していません");
      return;
    }

    try {
      // AudioContextを作成する
      if (
        !audioState.context ||
        audioState.context.state === "closed"
      ) {
        audioState.context = new AudioContextClass();
      }

      const audio = audioState.context;

      // 音声の再開が終わるまで待つ
      if (audio.state === "suspended") {
        await audio.resume();
      }

      if (audio.state !== "running") {
        console.warn("音声を再生できません。状態:", audio.state);
        return;
      }

      // 指の本数を1〜5本に制限する
      const count = Math.max(1, Math.min(fingerCount, 5));

      // 指の本数ごとに音程を変える
      const frequencies = {
        1: 440,
        2: 554,
        3: 659,
        4: 783,
      };

      const oscillator = audio.createOscillator();
      const gain = audio.createGain();

      // 5本指だけ音色を変える
      oscillator.type = count === 5 ? "square" : "sine";

      oscillator.frequency.setValueAtTime(
        frequencies[count],
        audio.currentTime
      );

      const duration = count === 5 ? 0.4 : 0.25;

      // 指定された音量を使う（0〜1）
      const safeVolume = Math.max(0, Math.min(volume, 1));

      // 0なら完全に無音にする
      if (safeVolume === 0) {
        return;
      }

      gain.gain.setValueAtTime(
        safeVolume,
        audio.currentTime
      );

      gain.gain.exponentialRampToValueAtTime(
        0.001,
        audio.currentTime + duration
      );

      oscillator.connect(gain);
      gain.connect(audio.destination);

      oscillator.start();
      oscillator.stop(audio.currentTime + duration);

      console.log(
        `音を再生：${count}本、音量=${safeVolume}`,
        `AudioContext=${audio.state}`
      );
    } catch (error) {
      console.error("音声の再生に失敗しました:", error);
    }
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
