const PHONIC_SAMPLE_RATE = 24_000;
const PHONIC_FRAME_SAMPLES = 480; // 20 ms, below Phonic's 40 ms maximum.

const state = {
  active: false,
  stream: null,
  socket: null,
  audioContext: null,
  recorder: null,
  micSource: null,
  silentGain: null,
  playbackSources: new Set(),
  nextPlayTime: 0,
  inputFrame: new Int16Array(PHONIC_FRAME_SAMPLES),
  inputFrameOffset: 0,
  inputTail: null,
  resamplePosition: 0,
  firstAudioChunk: true,
  phonicReady: false,
  lastMeterUpdate: 0,
  pendingReply: null,
  timer: null,
  startedAt: 0,
};

const callButton = document.querySelector("#call");
const audioInputSelect = document.querySelector("#audio-input");
const statusText = document.querySelector("#status");
const hint = document.querySelector("#hint");
const timer = document.querySelector("#timer");
const transcript = document.querySelector("#transcript");
const modelText = document.querySelector("#model");
const micMeter = document.querySelector("#mic-meter");
const micLevel = document.querySelector("#mic-level");

function setStatus(status, help = "") {
  statusText.textContent = status;
  hint.textContent = help;
}

function errorText(error) {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(raw);
    return parsed.error?.message || parsed.detail || raw;
  } catch {
    if (error?.name === "NotAllowedError") {
      return "Allow microphone access, then try again.";
    }
    return raw;
  }
}

function addMessage(role, text = "") {
  transcript.querySelector(".empty")?.remove();
  const bubble = document.createElement("p");
  bubble.className = `message ${role}`;
  bubble.textContent = text;
  transcript.append(bubble);
  transcript.scrollTop = transcript.scrollHeight;
  return bubble;
}

function startTimer() {
  clearInterval(state.timer);
  state.startedAt = Date.now();
  state.timer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
    timer.textContent = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  }, 1000);
}

function showModel(config) {
  const setupHint = config.configured ? "" : " · API key needed";
  modelText.textContent = `${config.model} · ${config.voice}${setupHint}`;
}

async function refreshAudioInputs(preferredId = audioInputSelect.value) {
  if (!navigator.mediaDevices?.enumerateDevices) {
    audioInputSelect.disabled = true;
    return;
  }
  const devices = (await navigator.mediaDevices.enumerateDevices())
    .filter((device) => device.kind === "audioinput");
  const options = [new Option("System default", "")];
  devices.forEach((device, index) => {
    options.push(new Option(device.label || `Microphone ${index + 1}`, device.deviceId));
  });
  audioInputSelect.replaceChildren(...options);
  if ([...audioInputSelect.options].some((option) => option.value === preferredId)) {
    audioInputSelect.value = preferredId;
  }
}

async function getSelectedMicrophone() {
  const deviceId = audioInputSelect.value;
  const audio = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (deviceId) audio.deviceId = { exact: deviceId };

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    await refreshAudioInputs(stream.getAudioTracks()[0]?.getSettings().deviceId);
    return stream;
  } catch (error) {
    if (deviceId && error?.name === "OverconstrainedError") {
      audioInputSelect.value = "";
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await refreshAudioInputs(stream.getAudioTracks()[0]?.getSettings().deviceId);
      return stream;
    }
    throw error;
  }
}

function updateMicMeter(input) {
  const now = performance.now();
  if (now - state.lastMeterUpdate < 60) return;
  state.lastMeterUpdate = now;
  let energy = 0;
  for (const sample of input) energy += sample * sample;
  const level = Math.min(100, Math.round(Math.sqrt(energy / input.length) * 500));
  micLevel.style.width = `${level}%`;
  micMeter.setAttribute("aria-valuenow", String(level));
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function sendPhonicSample(sample) {
  const clamped = Math.max(-1, Math.min(1, sample));
  state.inputFrame[state.inputFrameOffset] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  state.inputFrameOffset += 1;
  if (state.inputFrameOffset !== PHONIC_FRAME_SAMPLES) return;

  if (state.phonicReady && state.socket?.readyState === WebSocket.OPEN) {
    const message = {
      type: "audio_chunk",
      audio: bytesToBase64(new Uint8Array(state.inputFrame.buffer)),
    };
    if (state.firstAudioChunk) {
      message.iso_date_time = new Date().toISOString();
      state.firstAudioChunk = false;
    }
    state.socket.send(JSON.stringify(message));
  }
  state.inputFrame = new Int16Array(PHONIC_FRAME_SAMPLES);
  state.inputFrameOffset = 0;
}

function sendPhonicAudio(input) {
  updateMicMeter(input);
  const contextRate = state.audioContext.sampleRate;
  const ratio = contextRate / PHONIC_SAMPLE_RATE;
  const combined = new Float32Array(input.length + (state.inputTail === null ? 0 : 1));
  if (state.inputTail !== null) {
    combined[0] = state.inputTail;
    combined.set(input, 1);
  } else {
    combined.set(input);
  }

  while (state.resamplePosition < combined.length - 1) {
    const before = Math.floor(state.resamplePosition);
    const weight = state.resamplePosition - before;
    sendPhonicSample(combined[before] * (1 - weight) + combined[before + 1] * weight);
    state.resamplePosition += ratio;
  }
  state.resamplePosition -= combined.length - 1;
  state.inputTail = combined[combined.length - 1];
}

function clearPhonicPlayback() {
  for (const source of state.playbackSources) {
    try { source.stop(); } catch { /* The source may already have ended. */ }
  }
  state.playbackSources.clear();
  state.nextPlayTime = state.audioContext?.currentTime || 0;
}

function playPhonicAudio(encodedAudio) {
  const binary = atob(encodedAudio);
  const view = new DataView(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    view.setUint8(index, binary.charCodeAt(index));
  }
  const sampleCount = Math.floor(binary.length / 2);
  const audioBuffer = state.audioContext.createBuffer(1, sampleCount, PHONIC_SAMPLE_RATE);
  const channel = audioBuffer.getChannelData(0);
  for (let index = 0; index < sampleCount; index += 1) {
    channel[index] = view.getInt16(index * 2, true) / 0x8000;
  }

  const source = state.audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(state.audioContext.destination);
  const startAt = Math.max(state.audioContext.currentTime + 0.015, state.nextPlayTime);
  source.start(startAt);
  state.nextPlayTime = startAt + audioBuffer.duration;
  state.playbackSources.add(source);
  source.addEventListener("ended", () => state.playbackSources.delete(source));
}

function onPhonicEvent(data) {
  if (data.type === "input_text" && data.text) addMessage("user", data.text);
  if (data.type === "audio_chunk") {
    playPhonicAudio(data.audio);
    if (data.text) {
      if (!state.pendingReply) state.pendingReply = addMessage("assistant");
      state.pendingReply.textContent += data.text;
      transcript.scrollTop = transcript.scrollHeight;
    }
  }
  if (data.type === "user_started_speaking") {
    clearPhonicPlayback();
    state.pendingReply = null;
    setStatus("Listening…");
  }
  if (data.type === "user_finished_speaking") setStatus("Thinking…");
  if (data.type === "assistant_started_speaking") setStatus("Agent is speaking…", "You can interrupt at any time");
  if (data.type === "assistant_finished_speaking") {
    state.pendingReply = null;
    setStatus("On call", "Just speak when you're ready");
  }
  if (data.type === "error") {
    const message = typeof data.error === "string" ? data.error : data.error?.message;
    setStatus("Call error", message || "Phonic realtime API error");
  }
}

async function startPhonicCall(stream, audioContext) {
  const response = await fetch("/api/session", { method: "POST" });
  const body = await response.text();
  if (!response.ok) throw new Error(body);
  const session = JSON.parse(body);

  await audioContext.audioWorklet.addModule("/static/phonic-recorder.js");
  const micSource = audioContext.createMediaStreamSource(stream);
  const recorder = new AudioWorkletNode(audioContext, "phonic-recorder");
  const silentGain = audioContext.createGain();
  silentGain.gain.value = 0;
  recorder.port.addEventListener("message", (event) => sendPhonicAudio(event.data));
  recorder.port.start();
  micSource.connect(recorder);
  recorder.connect(silentGain);
  silentGain.connect(audioContext.destination);

  const socket = new WebSocket(`wss://api.phonic.ai/v1/sts/ws?session_token=${encodeURIComponent(session.session_token)}`);
  Object.assign(state, { socket, audioContext, recorder, micSource, silentGain });

  await new Promise((resolve, reject) => {
    let connected = false;
    const timeout = setTimeout(() => reject(new Error("The Phonic connection timed out.")), 15_000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify(session.config));
    });
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "ready_to_start_conversation" && !connected) {
        connected = true;
        clearTimeout(timeout);
        state.phonicReady = true;
        setStatus("On call", "Just speak when you're ready");
        resolve();
      }
      onPhonicEvent(data);
    });
    socket.addEventListener("error", () => {
      if (!connected) {
        clearTimeout(timeout);
        reject(new Error("Could not connect to Phonic."));
      }
    });
    socket.addEventListener("close", (event) => {
      if (!state.active) return;
      const message = event.reason || `Phonic closed the connection (${event.code}).`;
      endCall("Call ended", message);
    });
  });
}

async function startCall() {
  state.active = true;
  audioInputSelect.disabled = true;
  callButton.classList.add("active");
  callButton.setAttribute("aria-label", "End call");
  startTimer();

  try {
    setStatus("Connecting to Phonic…");
    const audioContext = new AudioContext();
    state.audioContext = audioContext;
    const resumeAudio = audioContext.resume();
    const stream = await getSelectedMicrophone();
    await resumeAudio;
    if (audioContext.state !== "running") {
      throw new Error("The browser blocked microphone audio. Press call again to retry.");
    }
    state.stream = stream;
    await startPhonicCall(stream, audioContext);
  } catch (error) {
    endCall("Call failed", errorText(error));
  }
}

function endCall(status = "Call ended", help = "Press the green button to call again") {
  state.active = false;
  state.socket?.close(1000, "Call ended");
  state.stream?.getTracks().forEach((track) => track.stop());
  state.recorder?.disconnect();
  state.micSource?.disconnect();
  state.silentGain?.disconnect();
  clearPhonicPlayback();
  state.audioContext?.close();
  clearInterval(state.timer);
  Object.assign(state, {
    stream: null,
    socket: null,
    audioContext: null,
    recorder: null,
    micSource: null,
    silentGain: null,
    playbackSources: new Set(),
    nextPlayTime: 0,
    inputFrame: new Int16Array(PHONIC_FRAME_SAMPLES),
    inputFrameOffset: 0,
    inputTail: null,
    resamplePosition: 0,
    firstAudioChunk: true,
    phonicReady: false,
    lastMeterUpdate: 0,
    pendingReply: null,
    timer: null,
  });
  audioInputSelect.disabled = false;
  micLevel.style.width = "0";
  micMeter.setAttribute("aria-valuenow", "0");
  callButton.classList.remove("active");
  callButton.setAttribute("aria-label", "Start call");
  timer.textContent = "00:00";
  setStatus(status, help);
}

callButton.addEventListener("click", () => state.active ? endCall() : startCall());
navigator.mediaDevices?.addEventListener("devicechange", () => {
  if (!state.active) refreshAudioInputs();
});
refreshAudioInputs().catch((error) => setStatus("Microphone error", errorText(error)));

fetch("/api/config")
  .then((response) => response.json())
  .then(showModel)
  .catch((error) => setStatus("Setup error", errorText(error)));
