/* ============ STATE ============ */
let conversation = []; // {role, content}
let reminders = [];    // {id, text, done}
let notes = [];         // {id, text}
let idCounter = 1;

let timerSeconds = 0;
let timerRunning = false;
let timerInterval = null;

let voiceOutputEnabled = false;
let isListening = false;
let recognition = null;
let preferredVoice = null;
const responseBank = window.RESPONSE_BANK || {};

/* ============ SYSTEM PROMPT ============ */
const SYSTEM_PROMPT = `You are "My Assistant" — a witty, sarcastic, but genuinely helpful personal AI assistant, in the spirit of a smarter, funnier Alexa/Siri. 
Personality rules:
- Be sharp, dry, a little sarcastic — like a clever friend who teases you but always comes through.
- Never be mean-spirited, never punch down, keep jokes light and quick.
- Keep responses SHORT and conversational (1-4 sentences usually) — this is a spoken/chat assistant, not an essay generator. Only go longer if the user asks for detail.
- You can help with general conversation, questions, advice, brainstorming, etc.
- You also manage reminders, notes, and a timer. If the user asks you to add a reminder, add a note, or control the timer, respond naturally AND include a hidden action tag at the very end of your reply on its own line, in this exact format (only if an action is needed):
[ACTION:{"type":"add_reminder","text":"..."}]
[ACTION:{"type":"add_note","text":"..."}]
[ACTION:{"type":"start_timer","seconds":N}]
[ACTION:{"type":"stop_timer"}]
[ACTION:{"type":"reset_timer"}]
Only include an ACTION tag when the user is clearly asking you to do one of these things. Never mention the tag itself to the user — it's invisible to them. Do not use markdown formatting like bullet points or headers in your replies; just talk like a person.`;

const ANTHROPIC_API_KEY = '';

/* ============ CHAT ============ */
const chatArea = document.getElementById('chatArea');
const textInput = document.getElementById('textInput');
const intro = document.getElementById('intro');
const clearBtn = document.querySelector('.clear-btn');
const sendBtn = document.getElementById('sendBtn');
const micBtn = document.getElementById('micBtn');
const speechToggleBtn = document.getElementById('speechToggleBtn');
const timerAdjust60Btn = document.querySelector('[data-adjust="60"]');
const timerAdjust300Btn = document.querySelector('[data-adjust="300"]');
const timerToggleBtn = document.getElementById('timerToggle');
const resetTimerBtn = document.querySelector('[data-action="reset-timer"]');

textInput.addEventListener('input', () => {
  textInput.style.height = 'auto';
  textInput.style.height = Math.min(textInput.scrollHeight, 140) + 'px';
});
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

if (clearBtn) clearBtn.addEventListener('click', clearChat);
if (sendBtn) sendBtn.addEventListener('click', sendMessage);
if (micBtn) micBtn.addEventListener('click', toggleListening);
if (speechToggleBtn) speechToggleBtn.addEventListener('click', toggleSpeechPermission);
if (timerAdjust60Btn) timerAdjust60Btn.addEventListener('click', () => adjustTimer(60));
if (timerAdjust300Btn) timerAdjust300Btn.addEventListener('click', () => adjustTimer(300));
if (timerToggleBtn) timerToggleBtn.addEventListener('click', toggleTimer);
if (resetTimerBtn) resetTimerBtn.addEventListener('click', resetTimer);

const menuBtn = document.getElementById('menuBtn');
const sidebarEl = document.querySelector('.sidebar');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');

function openSidebar() {
  if (sidebarEl) sidebarEl.classList.add('open');
  if (sidebarBackdrop) sidebarBackdrop.classList.add('show');
}

function closeSidebar() {
  if (sidebarEl) sidebarEl.classList.remove('open');
  if (sidebarBackdrop) sidebarBackdrop.classList.remove('show');
}

if (menuBtn) menuBtn.addEventListener('click', openSidebar);
if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);
if (sidebarEl) {
  sidebarEl.addEventListener('click', (event) => {
    if (window.innerWidth > 780) return;
    if (event.target.closest('.mini-btn') || event.target.closest('.chk') || event.target.closest('.del')) {
      closeSidebar();
    }
  });
}
window.addEventListener('resize', () => {
  if (window.innerWidth > 780) closeSidebar();
});

function pickFromBank(key) {
  const list = responseBank[key] || [];
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function getLocalReply(text) {
  const clean = text.trim();
  if (!clean) return null;

  const normalized = clean.toLowerCase();

  if (/(^|\b)(hi|hello|hey|yo|good morning|good afternoon|good evening)(\b|$)/.test(normalized)) {
    return pickFromBank('greetings') || "Hey there. I’m here and ready to help.";
  }

  if (/(how are you|how's it going|how are you doing|how do you feel|how's life)/.test(normalized)) {
    return pickFromBank('how') || "I’m doing well enough to be useful. You?";
  }

  if (/(thank you|thanks|thx)/.test(normalized)) {
    return pickFromBank('thanks') || "You’re welcome. Try not to make me regret it.";
  }

  if (/(bye|goodbye|see you|later)/.test(normalized)) {
    return pickFromBank('farewell') || "Take care. I’ll be here when your brain needs a second opinion.";
  }

  if (/(what is your name|who are you|what are you)/.test(normalized)) {
    return pickFromBank('identity') || "I’m My Assistant. A glorified helper with opinions.";
  }

  if (/(what can you do|help|abilities|do for me)/.test(normalized)) {
    return pickFromBank('capabilities') || "I can chat, keep reminders, jot notes, and run a timer for you.";
  }

  if (/(tell me a joke|joke|funny)/.test(normalized)) {
    return pickFromBank('jokes') || "Why did the computer go to therapy? It had too many bytes of emotional baggage.";
  }

  if (/(i am|i'm)\s+(fine|good|okay|sad|tired|hungry|bored|stressed|busy)/.test(normalized)) {
    return pickFromBank('moods') || "Fair enough. I hope the day treats you kindly.";
  }

  if (/(really|for real|seriously)/.test(normalized)) {
    return pickFromBank('really') || "Yes, really. The evidence is mostly in the room.";
  }

  if (/\byou sure\??\b|are you sure|really\?/.test(normalized)) {
    return pickFromBank('sure') || "Pretty sure. I’m a little dramatic, but not that dramatic.";
  }

  if (/\bokay\b|ok\b/.test(normalized)) {
    return pickFromBank('okay') || "Okay. We’ll keep moving before the mood changes.";
  }

  if (/(why|what|when|where|who|which)/.test(normalized)) {
    return pickFromBank('questions') || "I can answer that, but only if you keep it short and not too embarrassing.";
  }

  if (/(love|hate|need|want|feel|think|wish)/.test(normalized)) {
    return pickFromBank('everyday') || "That sounds like the kind of thing a person says before making a questionable decision.";
  }

  const mathCandidate = normalized
    .replace(/^(what is|what's|calculate|solve)\s+/, '')
    .replace(/\?$/, '')
    .trim();

  if (/^[0-9+\-*/().\s]+$/.test(mathCandidate)) {
    const safeExpression = mathCandidate.replace(/[^0-9+\-*/().\s]/g, '');
    if (safeExpression) {
      try {
        const result = Function(`"use strict"; return (${safeExpression});`)();
        if (typeof result === 'number' && Number.isFinite(result)) {
          return `That comes out to ${result}.`;
        }
      } catch (e) {
        /* ignore invalid math */
      }
    }
  }

  return null;
}

function renderMessage(role, text) {
  if (intro) intro.style.display = 'none';
  const msg = document.createElement('div');
  msg.className = 'msg ' + (role === 'user' ? 'user' : 'assistant');
  const label = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = role === 'user' ? 'You' : 'My Assistant';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  msg.appendChild(label);
  msg.appendChild(bubble);
  chatArea.appendChild(msg);
  chatArea.scrollTop = chatArea.scrollHeight;
  return bubble;
}

function showTyping() {
  const msg = document.createElement('div');
  msg.className = 'msg assistant';
  msg.id = 'typingMsg';
  const label = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = 'My Assistant';
  const bubble = document.createElement('div');
  bubble.className = 'bubble typing';
  bubble.innerHTML = '<span></span><span></span><span></span>';
  msg.appendChild(label);
  msg.appendChild(bubble);
  chatArea.appendChild(msg);
  chatArea.scrollTop = chatArea.scrollHeight;
}
function removeTyping() {
  const el = document.getElementById('typingMsg');
  if (el) el.remove();
}

async function sendMessage() {
  const text = textInput.value.trim();
  if (!text) return;
  textInput.value = '';
  textInput.style.height = 'auto';
  renderMessage('user', text);
  conversation.push({ role: 'user', content: text });

  const localReply = getLocalReply(text);
  if (localReply) {
    renderMessage('assistant', localReply);
    conversation.push({ role: 'assistant', content: localReply });
    speak(localReply);
    setStatus('', false);
    return;
  }

  setStatus('Thinking…', false);
  showTyping();
  document.getElementById('sendBtn').disabled = true;

  if (!ANTHROPIC_API_KEY) {
    removeTyping();
    setStatus('Missing API key', false);
    renderMessage('assistant', 'I need an API key configured in script.js before I can respond.');
    document.getElementById('sendBtn').disabled = false;
    return;
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANTHROPIC_API_KEY}`
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: conversation
      })
    });
    if (!response.ok) {
      let errorMessage = `${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData.error?.message) errorMessage = errorData.error.message;
      } catch (e) {
        /* ignore parse errors */
      }
      throw new Error(errorMessage);
    }
    const data = await response.json();
    let reply = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!reply) reply = "...I've got nothing. Even I have off moments.";

    // extract action tag
    const actionMatch = reply.match(/\[ACTION:(\{.*?\})\]\s*$/s);
    let displayReply = reply;
    if (actionMatch) {
      displayReply = reply.slice(0, actionMatch.index).trim();
      try {
        const action = JSON.parse(actionMatch[1]);
        handleAction(action);
      } catch (e) {
        /* ignore parse errors */
      }
    }

    removeTyping();
    renderMessage('assistant', displayReply);
    conversation.push({ role: 'assistant', content: reply });
    speak(displayReply);
    setStatus('', false);
  } catch (err) {
    console.error(err);
    removeTyping();
    renderMessage('assistant', "Something broke on my end. Try again — I promise I'm usually more competent.");
    setStatus(err?.message || 'Error reaching assistant', false);
  } finally {
    document.getElementById('sendBtn').disabled = false;
  }
}

function clearChat() {
  conversation = [];
  chatArea.innerHTML = '';
  chatArea.appendChild(intro);
  intro.style.display = 'block';
}

/* ============ ACTIONS ============ */
function handleAction(action) {
  if (action.type === 'add_reminder' && action.text) {
    addReminder(action.text);
  } else if (action.type === 'add_note' && action.text) {
    addNote(action.text);
  } else if (action.type === 'start_timer') {
    timerSeconds = action.seconds || 0;
    updateTimerDisplay();
    startTimer();
  } else if (action.type === 'stop_timer') {
    stopTimer();
  } else if (action.type === 'reset_timer') {
    resetTimer();
  }
}

/* ============ REMINDERS / NOTES ============ */
function addReminder(text) {
  reminders.push({ id: idCounter++, text, done: false });
  renderLists();
}
function addNote(text) {
  notes.push({ id: idCounter++, text });
  renderLists();
}
function toggleReminder(id) {
  const r = reminders.find((item) => item.id === id);
  if (r) r.done = !r.done;
  renderLists();
}
function deleteReminder(id) {
  reminders = reminders.filter((item) => item.id !== id);
  renderLists();
}
function deleteNote(id) {
  notes = notes.filter((item) => item.id !== id);
  renderLists();
}

function renderLists() {
  const remList = document.getElementById('reminderList');
  const noteList = document.getElementById('noteList');
  document.getElementById('remCount').textContent = reminders.length ? `(${reminders.length})` : '';
  document.getElementById('noteCount').textContent = notes.length ? `(${notes.length})` : '';

  remList.innerHTML = '';
  if (reminders.length === 0) {
    remList.innerHTML = '<div class="empty-state">Nothing yet. Ask me to remind you of something.</div>';
  } else {
    reminders.forEach((r) => {
      const li = document.createElement('li');
      li.className = 'task-item' + (r.done ? ' done' : '');
      li.innerHTML = `
        <div class="chk ${r.done ? 'checked' : ''}" onclick="toggleReminder(${r.id})"></div>
        <div class="txt">${escapeHtml(r.text)}</div>
        <div class="del" onclick="deleteReminder(${r.id})">&times;</div>
      `;
      remList.appendChild(li);
    });
  }

  noteList.innerHTML = '';
  if (notes.length === 0) {
    noteList.innerHTML = '<div class="empty-state">No notes. Your brain is the only storage right now — risky.</div>';
  } else {
    notes.forEach((n) => {
      const li = document.createElement('li');
      li.className = 'task-item';
      li.innerHTML = `
        <div class="txt">${escapeHtml(n.text)}</div>
        <div class="del" onclick="deleteNote(${n.id})">&times;</div>
      `;
      noteList.appendChild(li);
    });
  }
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ============ TIMER ============ */
function updateTimerDisplay() {
  const m = Math.floor(timerSeconds / 60).toString().padStart(2, '0');
  const s = (timerSeconds % 60).toString().padStart(2, '0');
  document.getElementById('timerDisplay').textContent = `${m}:${s}`;
}
function adjustTimer(delta) {
  timerSeconds = Math.max(0, timerSeconds + delta);
  updateTimerDisplay();
}
function startTimer() {
  if (timerInterval) return;
  if (timerSeconds <= 0) return;
  timerRunning = true;
  document.getElementById('timerToggle').textContent = 'Pause';
  timerInterval = setInterval(() => {
    timerSeconds--;
    updateTimerDisplay();
    if (timerSeconds <= 0) {
      stopTimer();
      setStatus("Timer's up. You're welcome.", true);
      renderMessage('assistant', "⏰ Timer's done. Whatever you were avoiding doing — go do it now.");
      speak("Timer's done. Go do the thing.");
    }
  }, 1000);
}
function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  timerRunning = false;
  document.getElementById('timerToggle').textContent = 'Start';
}
function resetTimer() {
  stopTimer();
  timerSeconds = 0;
  updateTimerDisplay();
}
function toggleTimer() {
  if (timerRunning) {
    stopTimer();
  } else {
    startTimer();
  }
}

/* ============ VOICE INPUT ============ */
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add('listening');
    playFeedbackTone('listen');
    setStatus('Listening…', true);
  };
  recognition.onresult = (event) => {
    let interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        final += event.results[i][0].transcript;
      } else {
        interim += event.results[i][0].transcript;
      }
    }
    if (interim) setStatus('Listening: "' + interim + '"', true);
    if (final) {
      textInput.value = final.trim();
    }
  };
  recognition.onerror = (e) => {
    setStatus('Mic error: ' + e.error, false);
  };
  recognition.onend = () => {
    isListening = false;
    micBtn.classList.remove('listening');
    playFeedbackTone('reply');
    if (textInput.value.trim()) {
      setStatus('', false);
      sendMessage();
    } else {
      setStatus('', false);
    }
  };
} else {
  micBtn.style.opacity = '0.35';
  micBtn.title = 'Voice input not supported in this browser';
}

function toggleListening() {
  if (!recognition) {
    setStatus('Voice input not supported in this browser. Try Chrome.', false);
    return;
  }
  if (isListening) {
    recognition.stop();
  } else {
    try {
      recognition.start();
    } catch (e) {
      /* already started */
    }
  }
}

function updateSpeechButton() {
  if (!speechToggleBtn) return;
  speechToggleBtn.classList.toggle('active', voiceOutputEnabled);
  speechToggleBtn.textContent = voiceOutputEnabled ? 'Auto Speech On' : 'Allow Auto Speech';
}

function toggleSpeechPermission() {
  if (voiceOutputEnabled) {
    voiceOutputEnabled = false;
    updateSpeechButton();
    setStatus('Auto speech disabled', false);
    return;
  }

  const allowed = window.confirm('Allow this assistant to speak replies automatically?');
  if (!allowed) {
    setStatus('Auto speech denied', false);
    return;
  }

  voiceOutputEnabled = true;
  updateSpeechButton();
  speak('Auto speech is enabled.');
  setStatus('Auto speech enabled', false);
}

/* ============ VOICE OUTPUT ============ */
function playFeedbackTone(type = 'reply') {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();

  oscillator.type = type === 'listen' ? 'sine' : 'triangle';
  oscillator.frequency.setValueAtTime(type === 'listen' ? 880 : 660, context.currentTime);

  gainNode.gain.setValueAtTime(0.0001, context.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.04, context.currentTime + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.2);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);

  oscillator.start();
  oscillator.stop(context.currentTime + 0.2);

  context.resume().catch(() => {});
  setTimeout(() => {
    context.close().catch(() => {});
  }, 250);
}

function getPreferredVoice() {
  if (preferredVoice) return preferredVoice;
  if (!window.speechSynthesis) return null;

  const voices = window.speechSynthesis.getVoices();
  preferredVoice = voices.find((voice) => voice.lang.startsWith('en')) || voices[0] || null;
  return preferredVoice;
}

function speak(text) {
  if (!voiceOutputEnabled) return;

  const clean = text.replace(/[*_#`]/g, '');
  if (!clean) return;

  if (!window.speechSynthesis) {
    playFeedbackTone('reply');
    return;
  }

  const utter = new SpeechSynthesisUtterance(clean);
  utter.rate = 1.05;
  utter.pitch = 0.95;
  utter.lang = 'en-US';

  const voice = getPreferredVoice();
  if (voice) utter.voice = voice;

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);

  if (!window.speechSynthesis.getVoices().length) {
    playFeedbackTone('reply');
  }
}

/* ============ STATUS ============ */
function setStatus(text, live) {
  const el = document.getElementById('statusLine');
  el.textContent = text;
  el.className = 'status-line' + (live ? ' live' : '');
}

/* ============ MASCOT ============ */
const mascotBtn = document.getElementById('mascotBtn');
const mascotSpeech = document.getElementById('mascotSpeech');
let mascotMoveIndex = 0;
let mascotTapCount = 0;
let mascotTapTimer = null;
let mascotSpeechTimer = null;
const mascotMovements = ['wave', 'nod', 'spin', 'jump', 'salute', 'lean'];

function showMascotSpeech() {
  if (!mascotSpeech) return;
  mascotSpeech.textContent = '[You peasant what do you want]';
  mascotSpeech.classList.add('show');
  clearTimeout(mascotSpeechTimer);
  mascotSpeechTimer = setTimeout(() => {
    mascotSpeech.classList.remove('show');
  }, 1800);
}

function triggerMascotMove() {
  if (!mascotBtn) return;
  mascotBtn.classList.remove(...mascotMovements.map((movement) => `mascot--${movement}`));
  const movement = mascotMovements[mascotMoveIndex % mascotMovements.length];
  mascotMoveIndex += 1;
  mascotBtn.classList.add(`mascot--${movement}`);
}

if (mascotBtn) {
  mascotBtn.addEventListener('click', () => {
    mascotTapCount += 1;
    clearTimeout(mascotTapTimer);
    mascotTapTimer = setTimeout(() => {
      mascotTapCount = 0;
    }, 2000);

    triggerMascotMove();

    if (mascotTapCount >= 3) {
      showMascotSpeech();
      mascotTapCount = 0;
    }
  });
}

/* ============ INIT ============ */
renderLists();
updateTimerDisplay();
updateSpeechButton();
