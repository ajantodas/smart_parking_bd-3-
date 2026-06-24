/* =====================================================
   SMART PARKING BD — app.js (Python Backend Edition)
   FastAPI + SQLite ব্যাকএন্ডের সাথে যুক্ত — সত্যিকারের multi-user/multi-device
   ===================================================== */

// ===== API BASE — backend এর সাথে একই origin এ serve হলে খালি রাখুন =====
const API_BASE = ""; // উদাহরণ: "https://your-app.onrender.com" — যদি ভিন্ন হোস্টে থাকে

const STATE = {
  currentUser: null,
  selectedSlot: null,
  selectedPayment: 'bkash',
  selectedDuration: 1,
  faceVerified: false,
  cameraStream: null,
  bookings: [],
  slots: [],
  userCount: 0,
  currentBookingData: {},
  countdownInterval: null,
  pollTimer: null,
  liveness: { detecting:false, smileDetected:false, headTurnDetected:false, step:0, _stepTimer:null, livenessComplete:false },
};

const TYPE_ICON  = {car:'🚗',suv:'🚙',motorcycle:'🏍️',truck:'🚛'};
const TYPE_PRICE = {car:50,suv:80,motorcycle:20,truck:100};
const PAY_NAMES  = {bkash:'বিকাশ',nagad:'নগদ',rocket:'রকেট',upay:'Upay',card:'কার্ড',cash:'ক্যাশ'};

/* =====================================================
   API HELPER
   ===================================================== */
async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const msg = (data && data.detail) ? data.detail : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/* =====================================================
   CLOUD SYNC — পোলিং দিয়ে backend থেকে স্টেট টানা (প্রতি ৩ সেকেন্ডে)
   ===================================================== */
async function fetchState() {
  try {
    const data = await api('/api/state');
    STATE.slots = data.slots.map(normalizeSlot);
    STATE.bookings = data.bookings.map(normalizeBooking);
    STATE.userCount = data.user_count;
    setSyncStatus(true);
    refreshAllViews();
  } catch (e) {
    console.error('[Sync] fetchState failed:', e);
    setSyncStatus(false);
  }
}

function normalizeSlot(s) {
  return { id: s.id, zone: s.zone, type: s.type, status: s.status, bookedBy: s.booked_by };
}
function normalizeBooking(b) {
  return {
    id: b.id, slotId: b.slot_id, slotZone: b.slot_zone, slotType: b.slot_type,
    carNumber: b.car_number, ownerName: b.owner_name, ownerPhone: b.owner_phone,
    duration: b.duration, price: b.price, paymentMethod: b.payment_method,
    status: b.status, createdAt: b.created_at, expiresAt: b.expires_at,
    faceVerified: !!b.face_verified, userId: b.user_id, userName: b.user_name,
  };
}

function startPolling() {
  if (STATE.pollTimer) clearInterval(STATE.pollTimer);
  STATE.pollTimer = setInterval(fetchState, 3000); // প্রতি ৩ সেকেন্ডে — multi-device sync
}

function setSyncStatus(online) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.className = `sync-indicator ${online?'online':'offline'}`;
  el.innerHTML = `<span class="sync-dot"></span>${online?'সার্ভার সিঙ্ক':'অফলাইন'}`;
}

function refreshAllViews() {
  updateHomeCounts();
  renderHomeMiniMap();
  if (document.getElementById('booking')?.classList.contains('active')) renderParkingGrid();
  if (document.getElementById('admin-dashboard')?.style.display !== 'none') renderAdminDashboard();
  if (document.getElementById('realtime')?.classList.contains('active')) renderRealtimeMap();
  if (document.getElementById('my-booking')?.classList.contains('active')) renderMyBookings();
}

/* ===== THEME / NAV ===== */
function toggleTheme() {
  const html=document.documentElement;
  const next=html.getAttribute('data-theme')==='dark'?'light':'dark';
  html.setAttribute('data-theme',next);
  document.getElementById('theme-btn').textContent=next==='dark'?'☀️':'🌙';
  localStorage.setItem('sp_theme',next);
}
function loadTheme() {
  const s=localStorage.getItem('sp_theme')||'light';
  document.documentElement.setAttribute('data-theme',s);
  const btn=document.getElementById('theme-btn');
  if (btn) btn.textContent=s==='dark'?'☀️':'🌙';
}
function toggleMobileMenu(){ document.getElementById('nav-links').classList.toggle('open'); }

function showSection(id) {
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-links a').forEach(a=>a.classList.remove('active-link'));
  const el=document.getElementById(id);
  if (el) el.classList.add('active');
  const link=document.querySelector(`[data-section="${id}"]`);
  if (link) link.classList.add('active-link');
  if (id==='booking') renderParkingGrid();
  if (id==='my-booking') renderMyBookings();
  if (id==='admin') checkAdminAccess();
  if (id==='realtime') renderRealtimeMap();
  if (id==='home') { updateHomeCounts(); generateDemoQR(); renderHomeMiniMap(); }
  document.getElementById('nav-links').classList.remove('open');
  window.scrollTo({top:0,behavior:'smooth'});
  return false;
}

/* ===== TOAST / LOADING ===== */
function toast(msg,type='') {
  const el=document.getElementById('toast');
  el.textContent=msg; el.className=`toast ${type} show`;
  setTimeout(()=>el.classList.remove('show'),3500);
}
function setLoading(show,text='প্রক্রিয়া করা হচ্ছে...') {
  document.getElementById('loading').style.display=show?'flex':'none';
  document.getElementById('loading-text').textContent=text;
}

/* ===== HOME ===== */
function updateHomeCounts() {
  const avail=STATE.slots.filter(s=>s.status==='available').length;
  const booked=STATE.slots.filter(s=>s.status==='booked').length;
  const a=document.getElementById('available-count'), b=document.getElementById('booked-count');
  if(a) a.textContent=avail;
  if(b) b.textContent=booked;
  const today=new Date().toDateString();
  const rev=STATE.bookings.filter(bk=>bk.status==='confirmed'&&bk.createdAt&&new Date(bk.createdAt).toDateString()===today).reduce((s,bk)=>s+bk.price,0);
  const hr=document.getElementById('home-revenue');
  if(hr) hr.textContent=rev;
}

function renderHomeMiniMap() {
  const map=document.getElementById('home-mini-map');
  if (!map) return;
  map.innerHTML=STATE.slots.map(s=>`
    <div class="mini-slot ${s.status}" onclick="${s.status==='available'?`quickBook('${s.id}')`:''}" title="${s.id}">
      ${TYPE_ICON[s.type]}<br><span style="font-size:.58rem">${s.id}</span>
    </div>`).join('');
}

function quickBook(slotId) {
  if (!STATE.currentUser) { toast('বুকিং করার জন্য লগইন করুন!','warning'); showSection('login'); return; }
  showSection('booking');
  selectSlot(slotId);
}

function generateDemoQR() {
  const el=document.getElementById('qr-display');
  if (!el) return;
  el.innerHTML='';
  try { new QRCode(el,{text:window.location.href+'?lot=SMART-PARKING-BD&zone=A',width:160,height:160,colorDark:'#7c3aed',colorLight:'#ffffff'}); }
  catch(e) { el.innerHTML='<p style="color:#9ca3af;font-size:.85rem">QR লোড হচ্ছে...</p>'; }
}

/* ===== TABS ===== */
function switchTab(tabId, btn) {
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  if (btn) btn.classList.add('active');
  else {
    const tabs=document.querySelectorAll('.tab-btn');
    (tabId==='register-tab'?tabs[1]:tabs[0]).classList.add('active');
  }
}
function togglePass(id) { const inp=document.getElementById(id); if(inp) inp.type=inp.type==='password'?'text':'password'; }
function validatePhone(el) { el.style.borderColor = el.value.length===11 && el.value.startsWith('01') ? 'var(--success)' : 'var(--border)'; }

/* =====================================================
   AUTH — backend API দিয়ে
   ===================================================== */
async function doLogin() {
  const phone=document.getElementById('login-phone').value.trim();
  const pass=document.getElementById('login-pass').value.trim();
  if (!phone||!pass) { toast('ফোন নম্বর ও পাসওয়ার্ড দিন','error'); return; }
  setLoading(true,'লগইন যাচাই করা হচ্ছে...');
  try {
    const user = await api('/api/login', { method:'POST', body: JSON.stringify({ phone, password: pass }) });
    setLoading(false);
    STATE.currentUser = user;
    setNavUser(user);
    toast(`স্বাগতম, ${user.name}! 🎉`,'success');
    showSection('booking');
  } catch (e) {
    setLoading(false);
    toast(e.message || 'ফোন নম্বর বা পাসওয়ার্ড ভুল!','error');
  }
}

async function doRegister() {
  const name=document.getElementById('reg-name').value.trim();
  const phone=document.getElementById('reg-phone').value.trim();
  const email=document.getElementById('reg-email').value.trim();
  const pass=document.getElementById('reg-pass').value.trim();
  if (!name||!phone||!pass) { toast('সব তথ্য পূরণ করুন','error'); return; }
  if (phone.length!==11) { toast('সঠিক ফোন নম্বর দিন (১১ সংখ্যা)','error'); return; }
  if (pass.length<6) { toast('পাসওয়ার্ড কমপক্ষে ৬ অক্ষর হতে হবে','error'); return; }

  setLoading(true,'রেজিস্ট্রেশন করা হচ্ছে...');
  try {
    const user = await api('/api/register', { method:'POST', body: JSON.stringify({ name, phone, email, password: pass }) });
    setLoading(false);
    STATE.currentUser = user;
    setNavUser(user);
    toast('রেজিস্ট্রেশন সফল! 🎉','success');
    showSection('booking');
  } catch (e) {
    setLoading(false);
    toast(e.message || 'রেজিস্ট্রেশনে সমস্যা হয়েছে','error');
  }
}

function setNavUser(user) {
  document.getElementById('nav-user').innerHTML =
    `<span style="font-size:.85rem;color:var(--primary);font-weight:700">👤 ${user.name}</span>
     <button class="btn-small" onclick="logout()" style="margin-left:.5rem">লগআউট</button>`;
}

function guestLogin() { toast('গেস্ট হিসেবে ব্রাউজ করুন — বুকিং করতে লগইন লাগবে','info'); showSection('home'); }

function logout() {
  STATE.currentUser = null;
  document.getElementById('nav-user').innerHTML = `<button class="btn-login-nav" onclick="showSection('login')">লগইন</button>`;
  toast('লগআউট সফল');
  showSection('home');
}

/* ===== ADMIN AUTH ===== */
function checkAdminAccess() {
  const loginCard=document.getElementById('admin-login');
  const dash=document.getElementById('admin-dashboard');
  if (STATE.currentUser && STATE.currentUser.isAdmin) {
    loginCard.style.display='none'; dash.style.display='block';
    renderAdminDashboard();
  } else {
    loginCard.style.display='block'; dash.style.display='none';
  }
}

async function adminLogin() {
  const u=document.getElementById('admin-user').value.trim();
  const p=document.getElementById('admin-pass').value.trim();
  setLoading(true,'যাচাই করা হচ্ছে...');
  try {
    await api('/api/admin-login', { method:'POST', body: JSON.stringify({ username:u, password:p }) });
    setLoading(false);
    STATE.currentUser = STATE.currentUser || {};
    STATE.currentUser.isAdmin = true;
    STATE.currentUser.name = STATE.currentUser.name || 'অ্যাডমিন';
    document.getElementById('admin-login').style.display='none';
    document.getElementById('admin-dashboard').style.display='block';
    renderAdminDashboard();
    toast('অ্যাডমিন লগইন সফল ✅','success');
  } catch (e) {
    setLoading(false);
    toast(e.message || 'ভুল ইউজারনেম বা পাসওয়ার্ড!','error');
  }
}

function adminLogout() {
  if (STATE.currentUser) STATE.currentUser.isAdmin = false;
  document.getElementById('admin-login').style.display='block';
  document.getElementById('admin-dashboard').style.display='none';
  document.getElementById('admin-user').value='';
  document.getElementById('admin-pass').value='';
  toast('অ্যাডমিন লগআউট সফল');
}

/* ===== PARKING GRID ===== */
let currentZoneFilter='ALL';
function filterZone(zone,btn) {
  currentZoneFilter=zone;
  document.querySelectorAll('.zone-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderParkingGrid();
}

function renderParkingGrid() {
  const grid=document.getElementById('parking-grid');
  if (!grid) return;
  const slots=currentZoneFilter==='ALL'?STATE.slots:STATE.slots.filter(s=>s.zone===currentZoneFilter);
  grid.innerHTML=slots.map(slot=>{
    const isSelected=STATE.selectedSlot&&STATE.selectedSlot.id===slot.id;
    const cls=`parking-slot ${slot.status}${isSelected?' selected':''}`;
    const clickable=slot.status==='available';
    return `<div class="${cls}" ${clickable?`onclick="selectSlot('${slot.id}')"`:''}
      title="${slot.id} — ${slot.status==='available'?'খালি':'বুক্ড'}">
      <span class="slot-icon">${TYPE_ICON[slot.type]}</span>
      <span class="slot-name">${slot.id}</span>
      <span class="slot-status-label">${slot.status==='available'?'খালি':'বুক্ড'}</span>
    </div>`;
  }).join('');
}

function selectSlot(slotId) {
  if (!STATE.currentUser) { toast('বুকিং করার জন্য লগইন করুন!','warning'); showSection('login'); return; }
  const slot=STATE.slots.find(s=>s.id===slotId);
  if (!slot||slot.status!=='available') { toast('এই স্লট এখন উপলব্ধ নয় — অন্য কেউ বুক করেছে','warning'); renderParkingGrid(); return; }
  STATE.selectedSlot=slot;
  renderParkingGrid();
  const card=document.getElementById('slot-info-card');
  card.style.display='block';
  document.getElementById('slot-detail-icon').textContent=TYPE_ICON[slot.type];
  document.getElementById('selected-slot-name').textContent=`স্লট ${slot.id} — Zone ${slot.zone}`;
  document.getElementById('slot-detail-desc').textContent=`${slot.type.toUpperCase()} পার্কিং`;
  document.getElementById('slot-rate-big').textContent=TYPE_PRICE[slot.type];
  updatePrice();
  card.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function setDuration(hrs,btn) {
  STATE.selectedDuration=hrs;
  document.querySelectorAll('.dur-chip').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  updatePrice();
}

function updatePrice() {
  if (!STATE.selectedSlot) return;
  const rate=TYPE_PRICE[STATE.selectedSlot.type];
  const price=rate*STATE.selectedDuration;
  document.getElementById('pb-rate').textContent=`৳ ${rate}/ঘণ্টা`;
  document.getElementById('pb-dur').textContent=`${STATE.selectedDuration} ঘণ্টা`;
  document.getElementById('total-price').textContent=`৳ ${price}`;
  ['bkash','nagad','rocket','upay'].forEach(m=>{
    const el=document.getElementById(`${m}-amount`);
    if (el) el.textContent=`৳ ${price}`;
  });
}

/* ===== STEPS ===== */
function goToStep(step) {
  if (step===2 && !STATE.selectedSlot) { toast('একটি পার্কিং স্লট বেছে নিন!','warning'); return; }
  if (step===3) {
    const carNum=document.getElementById('car-number').value.trim();
    const ownerName=document.getElementById('owner-name').value.trim();
    const ownerPhone=document.getElementById('owner-phone').value.trim();
    if (!carNum)     { toast('গাড়ির নম্বর প্লেট দিন!','error'); return; }
    if (!ownerName)  { toast('মালিকের নাম দিন!','error'); return; }
    if (!ownerPhone) { toast('ফোন নম্বর দিন!','error'); return; }
    if (!STATE.faceVerified) { toast('ফেস ভেরিফিকেশন সম্পন্ন করুন!','error'); return; }
    const price=TYPE_PRICE[STATE.selectedSlot.type]*STATE.selectedDuration;
    document.getElementById('summary-slot').textContent=STATE.selectedSlot.id;
    document.getElementById('summary-duration').textContent=`${STATE.selectedDuration} ঘণ্টা`;
    document.getElementById('summary-car').textContent=carNum.toUpperCase();
    document.getElementById('summary-owner').textContent=ownerName;
    document.getElementById('summary-total').textContent=`৳ ${price}`;
    updatePrice();
    stopCamera();
  }
  document.querySelectorAll('.booking-step').forEach(s=>s.classList.remove('active'));
  document.getElementById(`step-${step}`).classList.add('active');
  document.getElementById('booking-progress').style.width=(step/4*100)+'%';
  window.scrollTo({top:0,behavior:'smooth'});
}

/* ===== FACE DETECTION (লোকাল ক্যামেরা প্রসেসিং — সার্ভারে কিছু আপলোড হয় না) ===== */
async function startCamera() {
  resetLivenessState();
  const idle=document.getElementById('face-idle');
  if (idle) idle.style.display='none';
  document.getElementById('face-controls').style.display='flex';
  try {
    const stream=await navigator.mediaDevices.getUserMedia({video:{width:640,height:480,facingMode:'user'}});
    STATE.cameraStream=stream;
    const video=document.getElementById('face-video');
    video.srcObject=stream;
    const statusEl=document.getElementById('face-status');
    statusEl.textContent='📷 ক্যামেরা চালু — মুখ ফ্রেমে রাখুন';
    document.getElementById('capture-btn').disabled=true;
    document.getElementById('liveness-instructions').style.display='block';
    updateLivenessUI(0);
    video.addEventListener('playing', async ()=>{
      if (typeof faceapi!=='undefined') {
        statusEl.textContent='⏳ AI মডেল লোড হচ্ছে...';
        try {
          await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights'),
            faceapi.nets.faceLandmark68Net.loadFromUri('https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights'),
            faceapi.nets.faceExpressionNet.loadFromUri('https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights'),
          ]);
          statusEl.textContent='✅ AI রেডি — সোজা তাকান';
          startLivenessDetection();
        } catch(e) { startSimpleLiveness(); }
      } else { startSimpleLiveness(); }
    },{once:true});
  } catch(e) {
    toast('ক্যামেরা অ্যাক্সেস করা যাচ্ছে না!','error');
    document.getElementById('face-status').textContent='❌ ক্যামেরা অ্যাক্সেস নেই';
  }
}

function resetLivenessState() {
  STATE.liveness.livenessComplete=false;
  STATE.liveness.smileDetected=false;
  STATE.liveness.headTurnDetected=false;
  STATE.liveness.step=0;
  STATE.liveness.detecting=false;
  if (STATE.liveness._stepTimer){clearTimeout(STATE.liveness._stepTimer);STATE.liveness._stepTimer=null;}
  const cb=document.getElementById('capture-btn');
  if (cb) cb.disabled=true;
  const canvas=document.getElementById('face-canvas');
  if (canvas) canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
}

function updateLivenessUI(step) {
  [1,2,3].forEach(i=>{
    const el=document.getElementById(`lv-step-${i}`);
    const ck=document.getElementById(`lv-check-${i}`);
    if (!el) return;
    if (i-1<step){el.className='lv-step done';if(ck)ck.textContent='✅';}
    else if (i-1===step){el.className='lv-step active';if(ck)ck.textContent='⭕';}
    else {el.className='lv-step';if(ck)ck.textContent='⭕';}
  });
  const fill=document.getElementById('lv-progress-fill');
  const txt=document.getElementById('lv-progress-text');
  if (fill) fill.style.width=(step/3*100)+'%';
  if (txt) txt.textContent=`${step}/৩ সম্পন্ন`;
}

function markLivenessComplete() {
  if (STATE.liveness.livenessComplete) return;
  STATE.liveness.livenessComplete=true;
  STATE.liveness.smileDetected=true;
  STATE.liveness.headTurnDetected=true;
  updateLivenessUI(3);
  const cb=document.getElementById('capture-btn');
  if (cb){cb.disabled=false;cb.style.animation='pulse-btn 1s infinite';}
  document.getElementById('face-status').textContent='✅ লাইভনেস সম্পন্ন! এখন ক্যাপচার করুন।';
  toast('লাইভনেস ভেরিফাইড! ক্যাপচার করুন 📸','success');
}

async function startLivenessDetection() {
  const video=document.getElementById('face-video'),canvas=document.getElementById('face-canvas');
  const statusEl=document.getElementById('face-status');
  STATE.liveness.detecting=true; STATE.liveness.step=0; updateLivenessUI(0);
  const detect=async ()=>{
    if (!STATE.cameraStream||!STATE.liveness.detecting||STATE.liveness.livenessComplete) return;
    canvas.width=video.videoWidth; canvas.height=video.videoHeight;
    try {
      const dets=await faceapi.detectAllFaces(video,new faceapi.TinyFaceDetectorOptions({scoreThreshold:0.4})).withFaceLandmarks().withFaceExpressions();
      const ctx=canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height);
      if (!dets.length) {
        statusEl.textContent='🔍 মুখ খুঁজছি... ফ্রেমে আসুন';
        if (STATE.liveness._stepTimer){clearTimeout(STATE.liveness._stepTimer);STATE.liveness._stepTimer=null;}
        requestAnimationFrame(detect); return;
      }
      if (dets.length>1){statusEl.textContent='⚠️ শুধু একটি মুখ দেখান!';requestAnimationFrame(detect);return;}
      const {detection:{box},expressions:expr,landmarks}=dets[0];
      ctx.strokeStyle='rgba(124,58,237,.8)'; ctx.lineWidth=2;
      ctx.strokeRect(box.x,box.y,box.width,box.height);
      if (STATE.liveness.step===0) {
        statusEl.textContent='👀 মুখ সনাক্ত — সোজা তাকান...';
        if (!STATE.liveness._stepTimer) STATE.liveness._stepTimer=setTimeout(()=>{
          STATE.liveness._stepTimer=null; STATE.liveness.step=1; updateLivenessUI(1);
          statusEl.textContent='😊 এখন হাসুন!';
        },1500);
      } else if (STATE.liveness.step===1) {
        const happy=expr.happy||0;
        if (happy>0.65) {
          statusEl.textContent=`😊 হাসি ধরা হয়েছে! (${Math.round(happy*100)}%)`;
          if (!STATE.liveness._stepTimer) STATE.liveness._stepTimer=setTimeout(()=>{
            STATE.liveness._stepTimer=null; STATE.liveness.step=2; updateLivenessUI(2);
            statusEl.textContent='👈 মাথা বাঁদিকে ঘোরান!';
          },800);
        } else {
          if (STATE.liveness._stepTimer){clearTimeout(STATE.liveness._stepTimer);STATE.liveness._stepTimer=null;}
          statusEl.textContent=`😊 হাসুন! (${Math.round(happy*100)}%)`;
        }
      } else if (STATE.liveness.step===2) {
        const nose=landmarks.getNose(),fc=box.x+box.width/2,turn=(nose[3].x-fc)/box.width;
        if (turn<-0.08) {
          statusEl.textContent='👈 বাম ঘোরা সনাক্ত! ধরে রাখুন...';
          ctx.strokeStyle='rgba(16,185,129,.9)'; ctx.lineWidth=3;
          ctx.strokeRect(box.x,box.y,box.width,box.height);
          if (!STATE.liveness._stepTimer) STATE.liveness._stepTimer=setTimeout(()=>{
            STATE.liveness._stepTimer=null; markLivenessComplete();
          },700);
        } else {
          if (STATE.liveness._stepTimer){clearTimeout(STATE.liveness._stepTimer);STATE.liveness._stepTimer=null;}
          statusEl.textContent=`👈 মাথা বাঁদিকে ঘোরান (${Math.round(turn*-100)}%)`;
        }
      }
    } catch(e) { STATE.liveness.detecting=false; startSimpleLiveness(); return; }
    if (!STATE.liveness.livenessComplete) requestAnimationFrame(detect);
  };
  detect();
}

function startSimpleLiveness() {
  const video=document.getElementById('face-video'),statusEl=document.getElementById('face-status');
  document.getElementById('lv-step-1').querySelector('.lv-text p').textContent='ক্যামেরার সামনে বসুন';
  document.getElementById('lv-step-2').querySelector('.lv-text p').textContent='হাসুন বা মাথা নাড়ান';
  let prev=null,score=0,NEEDED=8;
  const cvs=document.createElement('canvas'); cvs.width=80; cvs.height=60;
  const ctx=cvs.getContext('2d');
  function check() {
    if (!STATE.cameraStream||STATE.liveness.livenessComplete) return;
    ctx.drawImage(video,0,0,80,60);
    const px=ctx.getImageData(0,0,80,60).data;
    if (prev) {
      let d=0; for(let i=0;i<px.length;i+=4) d+=Math.abs(px[i]-prev[i])+Math.abs(px[i+1]-prev[i+1])+Math.abs(px[i+2]-prev[i+2]);
      if (d/(px.length/4*3)>5) score++;
    }
    prev=new Uint8ClampedArray(px);
    updateLivenessUI(Math.min(Math.floor(score/NEEDED*3),2));
    if (score>=NEEDED) { markLivenessComplete(); return; }
    statusEl.textContent=`🔍 লাইভনেস... হাসুন/মাথা নাড়ান (${Math.min(score,NEEDED)}/${NEEDED})`;
    setTimeout(check,150);
  }
  if (video.readyState>=2) check(); else video.addEventListener('playing',check,{once:true});
  statusEl.textContent='🔍 লাইভনেস শুরু — হাসুন বা মাথা নাড়ান';
}

function captureFace() {
  if (!STATE.cameraStream) { toast('প্রথমে ক্যামেরা চালু করুন!','error'); return; }
  if (!STATE.liveness.livenessComplete) { toast('লাইভনেস চেক সম্পন্ন করুন!','error'); return; }
  const video=document.getElementById('face-video');
  const cvs=document.createElement('canvas');
  cvs.width=video.videoWidth||320; cvs.height=video.videoHeight||240;
  const ctx=cvs.getContext('2d'); ctx.drawImage(video,0,0);
  const data=ctx.getImageData(0,0,cvs.width,cvs.height);
  if (!data.data.some(v=>v!==0)) { toast('ছবি ক্যাপচার ব্যর্থ। আবার চেষ্টা করুন।','error'); return; }
  const url=cvs.toDataURL('image/jpeg',.85);
  STATE.capturedFace=url; STATE.faceVerified=true; STATE.liveness.detecting=false;
  document.getElementById('captured-face').src=url;
  document.getElementById('face-result').style.display='block';
  document.getElementById('face-idle').style.display='none';
  document.getElementById('face-controls').style.display='none';
  document.getElementById('liveness-instructions').style.display='none';
  document.getElementById('face-status').textContent='✅ রিয়েল ফেস ভেরিফাইড';
  stopCamera();
  toast('ফেস ভেরিফিকেশন সফল! 🎉','success');
}

function retryFace() {
  STATE.faceVerified=false; STATE.capturedFace=null;
  document.getElementById('face-result').style.display='none';
  document.getElementById('face-idle').style.display='block';
  document.getElementById('face-status').textContent='ক্যামেরা চালু করুন';
}

function stopCamera() {
  STATE.liveness.detecting=false;
  if (STATE.liveness._stepTimer){clearTimeout(STATE.liveness._stepTimer);STATE.liveness._stepTimer=null;}
  if (STATE.cameraStream){STATE.cameraStream.getTracks().forEach(t=>t.stop());STATE.cameraStream=null;}
}

/* =====================================================
   PAYMENT — UI সিমুলেশন (PIN/OTP মডাল), backend এ শুধু ফাইনাল রেজাল্ট পাঠানো হয়
   ===================================================== */
function selectPayment(method,btn) {
  STATE.selectedPayment=method;
  document.querySelectorAll('.pay-tab-btn').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else { const el=document.getElementById(`ptab-${method}`); if(el) el.classList.add('active'); }
  ['bkash','nagad','rocket','upay','card','cash'].forEach(m=>{
    const f=document.getElementById(`${m}-form`);
    if (f) f.style.display=m===method?'block':'none';
  });
  updatePrice();
  const names={bkash:'বিকাশে পেমেন্ট করুন',nagad:'নগদে পেমেন্ট করুন',rocket:'রকেটে পেমেন্ট করুন',upay:'Upay তে পেমেন্ট করুন',card:'কার্ডে পেমেন্ট করুন',cash:'বুকিং নিশ্চিত করুন'};
  const txt=document.getElementById('pay-btn-text');
  if (txt) txt.textContent=names[method]||'পেমেন্ট নিশ্চিত করুন';
}

function copyNumber(num,btn) {
  navigator.clipboard.writeText(num).then(()=>{
    toast('নম্বর কপি হয়েছে! 📋','success');
    if (btn){const old=btn.textContent;btn.textContent='✅ কপি হয়েছে';setTimeout(()=>btn.textContent=old,2000);}
  }).catch(()=>toast('কপি করুন: '+num,'info'));
}

function formatCard(el) {
  let v=el.value.replace(/\D/g,'').substring(0,16);
  v=v.replace(/(\d{4})/g,'$1 ').trim();
  el.value=v;
  const disp=document.getElementById('card-num-display');
  if (disp) disp.textContent=v||'•••• •••• •••• ••••';
}
function formatExpiry(el) {
  let v=el.value.replace(/\D/g,'');
  if (v.length>=2) v=v.substring(0,2)+'/'+v.substring(2,4);
  el.value=v;
  const disp=document.getElementById('card-exp-display');
  if (disp) disp.textContent=v||'MM/YY';
}

function processPayment() {
  if (!STATE.currentUser) { toast('পেমেন্টের জন্য লগইন করুন!','error'); return; }
  const method=STATE.selectedPayment;
  if (['bkash','nagad','rocket','upay'].includes(method)) {
    const numEl=document.getElementById(`${method}-number`);
    const trxEl=document.getElementById(`${method}-trxid`);
    if (!numEl||!numEl.value.trim()||numEl.value.trim().length<11) { toast(`${PAY_NAMES[method]} নম্বর সঠিকভাবে দিন (১১ সংখ্যা)!`,'error'); return; }
    if (!trxEl||!trxEl.value.trim()||trxEl.value.trim().length<8) { toast('Transaction ID সঠিকভাবে দিন!','error'); return; }
    showPinVerification(method, ()=>finalizePayment());
    return;
  }
  if (method==='card') {
    const cn=document.getElementById('card-number').value.replace(/\s/g,'');
    const exp=document.getElementById('card-expiry').value.trim();
    const cvv=document.getElementById('card-cvv').value.trim();
    const nm=document.getElementById('card-name').value.trim();
    if (!cn||cn.length<16){toast('সঠিক কার্ড নম্বর দিন!','error');return;}
    if (!exp||!/^\d{2}\/\d{2}$/.test(exp)){toast('মেয়াদ দিন (MM/YY)!','error');return;}
    if (!cvv||cvv.length<3){toast('CVV দিন!','error');return;}
    if (!nm){toast('কার্ড হোল্ডারের নাম দিন!','error');return;}
    showOtpVerification(()=>finalizePayment());
    return;
  }
  if (method==='cash') { finalizePayment(); return; }
  toast('পেমেন্ট পদ্ধতি বেছে নিন!','error');
}

function showPinVerification(method,onSuccess) {
  const price=TYPE_PRICE[STATE.selectedSlot.type]*STATE.selectedDuration;
  const num=document.getElementById(`${method}-number`).value.trim();
  const brandColors={bkash:'#e40076',nagad:'#f05022',rocket:'#3b30d9',upay:'#00a86b'};
  const brandBg={bkash:'#fff0f7',nagad:'#fff4f0',rocket:'#f0f0ff',upay:'#f0fff8'};
  const modal=document.createElement('div');
  modal.id='pay-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(6px);z-index:9990;display:flex;align-items:center;justify-content:center;padding:1rem';
  modal.innerHTML=`
    <div style="background:${brandBg[method]};border-radius:20px;width:100%;max-width:360px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="background:${brandColors[method]};padding:1.5rem;text-align:center;color:#fff">
        <div style="font-size:2.5rem;font-weight:900;margin-bottom:.25rem">${method==='rocket'?'🚀':PAY_NAMES[method]}</div>
        <div style="font-size:.9rem;opacity:.9">মোবাইল ব্যাংকিং</div>
      </div>
      <div style="padding:1.25rem;border-bottom:1px solid rgba(0,0,0,.1)">
        <div style="display:flex;justify-content:space-between;margin-bottom:.5rem;font-size:.88rem;color:#444">
          <span>পাঠানো হচ্ছে</span><strong style="color:${brandColors[method]};font-size:1.1rem">৳ ${price}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.82rem;color:#666"><span>আপনার নম্বর</span><span>${num}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:.82rem;color:#666;margin-top:.3rem"><span>মার্চেন্ট</span><span>Smart Parking BD</span></div>
      </div>
      <div style="padding:1.5rem;text-align:center">
        <p style="font-size:.88rem;color:#555;margin-bottom:1rem">আপনার ${PAY_NAMES[method]} পিন দিন</p>
        <div id="pin-dots" style="display:flex;justify-content:center;gap:.6rem;margin-bottom:1.25rem">
          ${[1,2,3,4,5].map(i=>`<div id="pin-dot-${i}" style="width:14px;height:14px;border-radius:50%;border:2px solid ${brandColors[method]};background:transparent;transition:background .2s"></div>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;max-width:240px;margin:0 auto">
          ${[1,2,3,4,5,6,7,8,9,'','0','⌫'].map(k=>`
            <button onclick="pinInput('${k}')" style="padding:.9rem;border-radius:10px;border:none;font-size:1.1rem;font-weight:700;cursor:pointer;background:${k===''?'transparent':'#fff'};color:${brandColors[method]};box-shadow:${k===''?'none':'0 2px 8px rgba(0,0,0,.1)'};${k===''?'pointer-events:none':''}" ${k===''?'disabled':''}>${k}</button>
          `).join('')}
        </div>
      </div>
      <div style="padding:1rem 1.5rem;display:flex;gap:.75rem">
        <button onclick="closePinModal()" style="flex:1;padding:.75rem;border-radius:10px;border:1.5px solid ${brandColors[method]};background:transparent;color:${brandColors[method]};font-size:.9rem;font-weight:700;cursor:pointer">বাতিল</button>
        <button id="pin-confirm-btn" onclick="confirmPin('${method}')" disabled style="flex:2;padding:.75rem;border-radius:10px;border:none;background:${brandColors[method]};color:#fff;font-size:.9rem;font-weight:700;cursor:pointer;opacity:.5">নিশ্চিত করুন</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  window._pinValue=''; window._pinCallback=onSuccess; window._pinColor=brandColors[method];
}

window._pinValue='';
function pinInput(key) {
  if (key==='⌫') window._pinValue=window._pinValue.slice(0,-1);
  else if (window._pinValue.length<5) window._pinValue+=key;
  for(let i=1;i<=5;i++){const dot=document.getElementById(`pin-dot-${i}`);if(dot)dot.style.background=i<=window._pinValue.length?window._pinColor:'transparent';}
  const btn=document.getElementById('pin-confirm-btn');
  if(btn){btn.disabled=window._pinValue.length<5;btn.style.opacity=window._pinValue.length>=5?'1':'.5';}
}

function confirmPin(method) {
  if (window._pinValue.length<5) { toast('৫ সংখ্যার পিন দিন!','error'); return; }
  closePinModal();
  setLoading(true,'পিন যাচাই করা হচ্ছে...');
  setTimeout(()=>{ setLoading(false); showPaymentSuccessModal(method,window._pinCallback); },1800);
}
function closePinModal() { const m=document.getElementById('pay-modal'); if (m) m.remove(); }

function showOtpVerification(onSuccess) {
  const modal=document.createElement('div');
  modal.id='pay-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(6px);z-index:9990;display:flex;align-items:center;justify-content:center;padding:1rem';
  const otp=String(Math.floor(100000+Math.random()*900000));
  window._expectedOtp=otp;
  modal.innerHTML=`
    <div style="background:#fff;border-radius:20px;width:100%;max-width:360px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="background:linear-gradient(135deg,#7c3aed,#06b6d4);padding:1.5rem;text-align:center;color:#fff">
        <div style="font-size:2rem;margin-bottom:.25rem">💳 3D Secure</div>
        <div style="font-size:.88rem;opacity:.9">কার্ড ভেরিফিকেশন</div>
      </div>
      <div style="padding:1.5rem;text-align:center">
        <p style="font-size:.85rem;color:#555;margin-bottom:.75rem">আপনার ব্যাংক নিবন্ধিত মোবাইলে OTP পাঠানো হয়েছে</p>
        <div style="background:#f0f4ff;border-radius:10px;padding:.75rem;margin-bottom:1.25rem;font-size:.78rem;color:#444">
          📱 ডেমো OTP: <strong style="color:#7c3aed;font-size:1.1rem;letter-spacing:.15em">${otp}</strong>
        </div>
        <div style="display:flex;gap:.4rem;justify-content:center;margin-bottom:1rem">
          ${[1,2,3,4,5,6].map(i=>`<input id="otp-${i}" maxlength="1" type="text" style="width:42px;height:48px;text-align:center;border:2px solid #e5e7eb;border-radius:8px;font-size:1.2rem;font-weight:700;color:#7c3aed" oninput="otpInput(this,${i})" onkeydown="otpBack(event,${i})">`).join('')}
        </div>
        <p style="font-size:.75rem;color:#999">OTP ৫ মিনিটের মধ্যে মেয়াদ শেষ হবে</p>
      </div>
      <div style="padding:1rem 1.5rem;display:flex;gap:.75rem">
        <button onclick="closePinModal()" style="flex:1;padding:.75rem;border-radius:10px;border:1.5px solid #7c3aed;background:transparent;color:#7c3aed;font-size:.9rem;font-weight:700;cursor:pointer">বাতিল</button>
        <button id="otp-confirm-btn" onclick="confirmOtp()" style="flex:2;padding:.75rem;border-radius:10px;border:none;background:linear-gradient(135deg,#7c3aed,#06b6d4);color:#fff;font-size:.9rem;font-weight:700;cursor:pointer">যাচাই করুন</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  window._otpCallback=onSuccess;
  setTimeout(()=>document.getElementById('otp-1')?.focus(),100);
}
function otpInput(el,i){el.value=el.value.replace(/\D/g,'');if(el.value&&i<6)document.getElementById(`otp-${i+1}`)?.focus();}
function otpBack(e,i){if(e.key==='Backspace'&&!e.target.value&&i>1)document.getElementById(`otp-${i-1}`)?.focus();}

function confirmOtp() {
  const entered=[1,2,3,4,5,6].map(i=>document.getElementById(`otp-${i}`)?.value||'').join('');
  if (entered.length<6) { toast('৬ সংখ্যার OTP দিন!','error'); return; }
  if (entered!==window._expectedOtp) { toast('OTP ভুল! আবার চেষ্টা করুন।','error'); return; }
  closePinModal();
  setLoading(true,'কার্ড যাচাই হচ্ছে...');
  setTimeout(()=>{ setLoading(false); showPaymentSuccessModal('card',window._otpCallback); },1500);
}

function showPaymentSuccessModal(method,onSuccess) {
  const price=TYPE_PRICE[STATE.selectedSlot.type]*STATE.selectedDuration;
  const modal=document.createElement('div');
  modal.id='pay-success-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(6px);z-index:9990;display:flex;align-items:center;justify-content:center;padding:1rem';
  modal.innerHTML=`
    <div style="background:#fff;border-radius:20px;width:100%;max-width:340px;text-align:center;padding:2rem;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="font-size:4rem;animation:pop .5s cubic-bezier(.175,.885,.32,1.275)">✅</div>
      <h3 style="color:#10b981;margin:.75rem 0 .35rem;font-size:1.2rem">পেমেন্ট সফল!</h3>
      <p style="color:#6b7280;font-size:.85rem;margin-bottom:1.25rem">${PAY_NAMES[method]} এর মাধ্যমে পেমেন্ট সম্পন্ন</p>
      <div style="background:#f0fdf4;border-radius:12px;padding:1rem;margin-bottom:1.25rem;border:1px solid #86efac">
        <div style="font-size:1.8rem;font-weight:900;color:#15803d">৳ ${price}</div>
        <div style="font-size:.78rem;color:#15803d;margin-top:.2rem">পরিমাণ সফলভাবে কেটে নেওয়া হয়েছে</div>
      </div>
      <div style="font-size:.75rem;color:#9ca3af;margin-bottom:1.25rem">TrxID: <strong>${Date.now().toString(36).toUpperCase()}</strong></div>
      <button onclick="closeSuccessModal(true)" style="width:100%;padding:.85rem;border-radius:10px;background:linear-gradient(135deg,#10b981,#06b6d4);color:#fff;border:none;font-size:.95rem;font-weight:700;cursor:pointer">বুকিং নিশ্চিত করুন →</button>
    </div>`;
  document.body.appendChild(modal);
  window._paySuccessCallback=onSuccess;
}
function closeSuccessModal(proceed) {
  const m=document.getElementById('pay-success-modal'); if (m) m.remove();
  if (proceed&&window._paySuccessCallback) window._paySuccessCallback();
}

/* =====================================================
   FINALIZE BOOKING — backend /api/book কল (server-side race-condition-safe)
   ===================================================== */
async function finalizePayment() {
  const carNum=document.getElementById('car-number').value.trim().toUpperCase();
  const ownerName=document.getElementById('owner-name').value.trim();
  const ownerPhone=document.getElementById('owner-phone').value.trim();
  const slotId=STATE.selectedSlot.id;

  setLoading(true,'বুকিং নিশ্চিত করা হচ্ছে...');

  try {
    const booking = await api('/api/book', {
      method: 'POST',
      body: JSON.stringify({
        slot_id: slotId,
        car_number: carNum,
        owner_name: ownerName,
        owner_phone: ownerPhone,
        duration: STATE.selectedDuration,
        payment_method: STATE.selectedPayment,
        face_verified: STATE.faceVerified,
        user_id: STATE.currentUser.id,
        user_name: STATE.currentUser.name,
      }),
    });

    setLoading(false);
    await fetchState(); // সাথে সাথে নিজের ভিউ রিফ্রেশ করো, পোলিং এর জন্য অপেক্ষা না করে
    const normalized = normalizeBooking(booking);
    STATE.currentBookingData = normalized;
    showConfirmation(normalized);
  } catch (err) {
    setLoading(false);
    if (err.message === 'SLOT_TAKEN') {
      toast('দুঃখিত! এই স্লট মাত্র অন্য কেউ বুক করে ফেলেছে। আরেকটি স্লট বেছে নিন।','error');
      await fetchState();
      goToStep(1);
    } else {
      console.error(err);
      toast(err.message || 'বুকিং করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।','error');
    }
  }
}

/* ===== CONFIRMATION ===== */
function showConfirmation(booking) {
  document.querySelectorAll('.booking-step').forEach(s=>s.classList.remove('active'));
  document.getElementById('step-4').classList.add('active');
  document.getElementById('booking-progress').style.width='100%';
  document.getElementById('conf-booking-id').textContent=booking.id;
  document.getElementById('conf-slot').textContent=booking.slotId;
  document.getElementById('conf-car').textContent=booking.carNumber;
  document.getElementById('conf-duration').textContent=`${booking.duration} ঘণ্টা`;
  document.getElementById('conf-total').textContent=`৳ ${booking.price}`;
  document.getElementById('conf-payment').textContent=PAY_NAMES[booking.paymentMethod]||booking.paymentMethod;
  document.getElementById('conf-date').textContent=new Date(booking.createdAt).toLocaleString('bn-BD');
  generateBookingQR(booking);
  startCountdownTimer(booking);
  spawnConfetti();
  toast('বুকিং সফল! 🎉','success');
  window.scrollTo({top:0,behavior:'smooth'});
}

function startCountdownTimer(booking) {
  const timerCard=document.getElementById('booking-timer-card');
  const display=document.getElementById('booking-countdown');
  const fill=document.getElementById('timer-bar-fill');
  if (!timerCard||!display) return;
  timerCard.style.display='block';
  const totalMs=booking.duration*3600000;
  const endTime=booking.expiresAt;
  if (STATE.countdownInterval) clearInterval(STATE.countdownInterval);
  function tick() {
    const left=endTime-Date.now();
    if (left<=0){display.textContent='০০:০০:০০';if(fill)fill.style.width='0%';clearInterval(STATE.countdownInterval);return;}
    const h=Math.floor(left/3600000),m=Math.floor((left%3600000)/60000),s=Math.floor((left%60000)/1000);
    display.textContent=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    if (fill) fill.style.width=(left/totalMs*100)+'%';
    if (left<600000){timerCard.style.border='2px solid var(--warning)';display.style.color='#fbbf24';}
    if (left<120000){timerCard.style.border='2px solid var(--danger)';display.style.color='var(--danger)';}
  }
  tick();
  STATE.countdownInterval=setInterval(tick,1000);
}

function spawnConfetti() {
  const wrap=document.getElementById('confetti-wrap');
  if (!wrap) return;
  wrap.innerHTML='';
  const colors=['#7c3aed','#06b6d4','#10b981','#fbbf24','#f87171','#a78bfa'];
  for (let i=0;i<50;i++) {
    const c=document.createElement('div');
    c.className='confetti-piece';
    c.style.cssText=`left:${Math.random()*100}%;background:${colors[Math.floor(Math.random()*colors.length)]};animation-delay:${Math.random()*1.5}s;animation-duration:${2+Math.random()*2}s;width:${6+Math.random()*8}px;height:${6+Math.random()*8}px;border-radius:${Math.random()>.5?'50%':'2px'};`;
    wrap.appendChild(c);
  }
}

/* ===== QR ===== */
function generateBookingQR(booking) {
  const el=document.getElementById('booking-qr');
  el.innerHTML='';
  const qrData=JSON.stringify({id:booking.id,slot:booking.slotId,car:booking.carNumber,duration:booking.duration,expires:booking.expiresAt,status:'confirmed'});
  const tick=document.getElementById('qr-ticket-slot');
  if(tick) tick.textContent=`স্লট: ${booking.slotId} | ${booking.duration}ঘণ্টা | ৳${booking.price}`;
  try { new QRCode(el,{text:qrData,width:200,height:200,colorDark:'#7c3aed',colorLight:'#ffffff'}); }
  catch(e) { el.innerHTML=`<p style="color:#9ca3af">QR: ${booking.id}</p>`; }
}

function downloadQR() {
  const c=document.querySelector('#booking-qr canvas');
  if (!c){toast('QR পাওয়া যাচ্ছে না','error');return;}
  const a=document.createElement('a'); a.download=`parking-qr-${STATE.currentBookingData.id}.png`; a.href=c.toDataURL(); a.click();
  toast('QR ডাউনলোড হচ্ছে...','info');
}

function shareBooking() {
  const b=STATE.currentBookingData;
  if (!b.id) return;
  const text=`স্মার্ট পার্কিং বুকিং\nবুকিং আইডি: ${b.id}\nস্লট: ${b.slotId}\nগাড়ি: ${b.carNumber}\nমোট: ৳${b.price}`;
  if (navigator.share) navigator.share({title:'Smart Parking BD',text});
  else navigator.clipboard.writeText(text).then(()=>toast('বুকিং তথ্য কপি হয়েছে!','success'));
}

function printBooking() {
  const b=STATE.currentBookingData;
  if (!b.id) return;
  const c=document.querySelector('#booking-qr canvas');
  const qr=c?c.toDataURL():'';
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>টিকিট-${b.id}</title>
  <style>body{font-family:'Segoe UI',Arial;max-width:400px;margin:2rem auto;padding:1rem;background:#fff;color:#1e1b4b}
  h1{color:#7c3aed;text-align:center;font-size:1.2rem}.logo{text-align:center;font-size:2.5rem}
  hr{border:none;border-top:2px dashed #e5e7eb;margin:1rem 0}
  .row{display:flex;justify-content:space-between;margin:.4rem 0;font-size:.88rem}.label{color:#6b7280}
  .qr{text-align:center;margin:1.5rem 0}.qr img{border:3px solid #7c3aed;border-radius:12px}
  .badge{background:#dcfce7;color:#15803d;padding:3px 12px;border-radius:20px;font-weight:700}
  .footer{text-align:center;font-size:.78rem;color:#9ca3af;margin-top:1rem}
  @media print{body{margin:0}}</style></head><body>
  <div class="logo">🅿️</div><h1>Smart Parking BD</h1>
  <p style="text-align:center;color:#6b7280;font-size:.85rem">পার্কিং টিকিট</p><hr>
  <div class="row"><span class="label">বুকিং আইডি:</span><strong>${b.id}</strong></div>
  <div class="row"><span class="label">স্লট:</span><strong>${b.slotId}</strong></div>
  <div class="row"><span class="label">গাড়ি:</span><strong>${b.carNumber}</strong></div>
  <div class="row"><span class="label">মালিক:</span><strong>${b.ownerName}</strong></div>
  <div class="row"><span class="label">সময়কাল:</span><strong>${b.duration} ঘণ্টা</strong></div>
  <div class="row"><span class="label">পেমেন্ট:</span><strong>${PAY_NAMES[b.paymentMethod]||b.paymentMethod}</strong></div>
  <div class="row"><span class="label">মোট:</span><strong>৳ ${b.price}</strong></div>
  <div class="row"><span class="label">স্ট্যাটাস:</span><span class="badge">✅ নিশ্চিত</span></div><hr>
  <div class="qr">${qr?`<img src="${qr}" width="180" height="180">`:'<p>'+b.id+'</p>'}
  <p style="font-size:.78rem;color:#6b7280;margin-top:.5rem">প্রবেশ ও বের হওয়ার সময় এই QR দেখান</p></div><hr>
  <div class="footer"><p>Smart Car Parking System BD</p><p>ধন্যবাদ</p></div>
  </body></html>`);
  w.document.close(); setTimeout(()=>w.print(),500);
}

function newBooking() {
  STATE.selectedSlot=null; STATE.faceVerified=false; STATE.capturedFace=null;
  STATE.currentBookingData={}; STATE.selectedDuration=1; STATE.selectedPayment='bkash';
  STATE.liveness={detecting:false,smileDetected:false,headTurnDetected:false,step:0,_stepTimer:null,livenessComplete:false};
  ['car-number','owner-name','owner-phone','bkash-number','bkash-trxid','nagad-number','nagad-trxid','rocket-number','rocket-trxid','upay-number','upay-trxid','card-number','card-expiry','card-cvv','card-name'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  document.getElementById('face-result').style.display='none';
  document.getElementById('face-idle').style.display='block';
  document.getElementById('face-controls').style.display='none';
  document.getElementById('slot-info-card').style.display='none';
  document.getElementById('liveness-instructions').style.display='none';
  document.getElementById('face-status').textContent='ক্যামেরা চালু করুন';
  document.getElementById('capture-btn').disabled=true;
  document.getElementById('booking-qr').innerHTML='';
  document.getElementById('booking-progress').style.width='25%';
  if (STATE.countdownInterval) clearInterval(STATE.countdownInterval);
  document.querySelectorAll('.dur-chip').forEach((c,i)=>c.classList.toggle('active',i===0));
  selectPayment('bkash', document.getElementById('ptab-bkash'));
  showSection('booking');
  document.querySelectorAll('.booking-step').forEach(s=>s.classList.remove('active'));
  document.getElementById('step-1').classList.add('active');
  toast('নতুন বুকিং শুরু করুন','info');
}

/* ===== MY BOOKINGS ===== */
let currentBookingFilter='all';
function filterBookings(filter,btn) {
  currentBookingFilter=filter;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderMyBookings();
}

function renderMyBookings() {
  const list=document.getElementById('my-bookings-list');
  if (!list) return;
  const statusLabel={confirmed:'নিশ্চিত',expired:'মেয়াদ শেষ',cancelled:'বাতিল'};
  const statusCls={confirmed:'status-confirmed',expired:'status-expired',cancelled:'status-expired'};

  if (!STATE.currentUser) {
    list.innerHTML=`<div class="card" style="text-align:center;padding:2.5rem">
      <p style="font-size:3rem;margin-bottom:1rem">🔐</p>
      <p style="color:var(--text-muted);margin-bottom:1.5rem">বুকিং দেখার জন্য লগইন করুন।</p>
      <button class="btn-primary" onclick="showSection('login')">লগইন করুন</button>
    </div>`; return;
  }

  let bookings=STATE.bookings.filter(b=>b.userId===STATE.currentUser.id);
  if (currentBookingFilter==='confirmed') bookings=bookings.filter(b=>b.status==='confirmed');
  if (currentBookingFilter==='cancelled') bookings=bookings.filter(b=>b.status==='cancelled'||b.status==='expired');

  if (!bookings.length) {
    list.innerHTML=`<div class="card" style="text-align:center;padding:2.5rem">
      <p style="font-size:3rem;margin-bottom:1rem">🅿️</p>
      <p style="color:var(--text-muted);margin-bottom:1.5rem">কোনো বুকিং নেই।</p>
      <button class="btn-primary" onclick="showSection('booking')">এখনই বুকিং করুন</button>
    </div>`; return;
  }

  list.innerHTML=bookings.slice().reverse().map(b=>{
    const isActive=b.status==='confirmed';
    const timeLeft=isActive?getTimeLeft(b.expiresAt):'';
    return `<div class="booking-item ${b.status==='cancelled'||b.status==='expired'?'cancelled':''}">
      <div style="font-size:2.2rem">${TYPE_ICON[b.slotType]||'🚗'}</div>
      <div class="booking-item-info">
        <strong>${b.slotId} — ${b.carNumber}</strong>
        <span>${b.ownerName} | ${b.duration}ঘণ্টা | ${PAY_NAMES[b.paymentMethod]||b.paymentMethod} | ৳${b.price}</span>
        <span>${new Date(b.createdAt).toLocaleString('bn-BD')}</span>
        ${isActive?`<span style="color:var(--primary);font-family:monospace;font-weight:700">⏳ ${timeLeft} বাকি</span>`:''}
      </div>
      <div style="display:flex;flex-direction:column;gap:.5rem;align-items:flex-end">
        <span class="status-badge ${statusCls[b.status]||'status-pending'}">${statusLabel[b.status]||b.status}</span>
        <span style="font-size:.72rem;color:var(--text-muted)">আইডি: ${b.id}</span>
        <button class="btn-small" onclick="showBookingQR('${b.id}')">🎫 QR</button>
      </div>
    </div>`;
  }).join('');
}

function getTimeLeft(expiresMs) {
  const left=expiresMs-Date.now();
  if (left<=0) return 'মেয়াদ শেষ';
  const h=Math.floor(left/3600000),m=Math.floor((left%3600000)/60000);
  return h>0?`${h}ঘণ্টা ${m}মিনিট`:`${m}মিনিট`;
}

function showBookingQR(bookingId) {
  const b=STATE.bookings.find(bk=>bk.id===bookingId);
  if (!b){toast('বুকিং পাওয়া যায়নি','error');return;}
  STATE.currentBookingData=b;
  showSection('booking');
  showConfirmation(b);
}

/* ===== REALTIME MAP ===== */
function renderRealtimeMap() {
  const avail=STATE.slots.filter(s=>s.status==='available').length;
  const booked=STATE.slots.filter(s=>s.status==='booked').length;
  const total=STATE.slots.length||1;
  document.getElementById('rt-available').textContent=avail;
  document.getElementById('rt-booked').textContent=booked;
  document.getElementById('rt-occupancy').textContent=Math.round(booked/total*100)+'%';
  document.getElementById('last-updated').textContent='আপডেট: এখন (লাইভ)';
  ['A','B','C'].forEach(zone=>{
    const el=document.getElementById(`rt-zone-${zone.toLowerCase()}`);
    if (!el) return;
    el.innerHTML=STATE.slots.filter(s=>s.zone===zone).map(s=>`
      <div class="map-slot ${s.status}" onclick="${s.status==='available'?`quickBook('${s.id}')`:''}" title="${s.id}">${TYPE_ICON[s.type]}<br>${s.id}</div>
    `).join('');
  });
}

/* ===== ADMIN ===== */
function renderAdminDashboard() {
  const avail=STATE.slots.filter(s=>s.status==='available').length;
  const booked=STATE.slots.filter(s=>s.status==='booked').length;
  const today=new Date().toDateString();
  const revenue=STATE.bookings.filter(b=>b.status==='confirmed'&&new Date(b.createdAt).toDateString()===today).reduce((s,b)=>s+b.price,0);
  document.getElementById('admin-total').textContent=STATE.slots.length;
  document.getElementById('admin-available').textContent=avail;
  document.getElementById('admin-booked').textContent=booked;
  document.getElementById('admin-revenue').textContent=`৳ ${revenue}`;
  document.getElementById('admin-total-bookings').textContent=STATE.bookings.length;
  document.getElementById('admin-users').textContent=STATE.userCount;
  renderAdminGrid();
  renderAdminTable();
}

function renderAdminGrid() {
  const g=document.getElementById('admin-parking-grid');
  if (!g) return;
  g.innerHTML=STATE.slots.map(s=>{
    const b=s.status==='booked'?STATE.bookings.find(bk=>bk.id===s.bookedBy):null;
    const timeLeft=b?getTimeLeft(b.expiresAt):'';
    return `<div class="parking-slot ${s.status}" onclick="toggleAdminSlot('${s.id}')" title="${s.id}${b?' | মেয়াদ: '+timeLeft:''}">
      <span class="slot-icon">${TYPE_ICON[s.type]}</span>
      <span class="slot-name">${s.id}</span>
      <span class="slot-status-label">${s.status==='available'?'খালি':timeLeft||'বুক্ড'}</span>
    </div>`;
  }).join('');
}

async function toggleAdminSlot(id) {
  setLoading(true,'স্লট আপডেট হচ্ছে...');
  try {
    await api('/api/admin/toggle-slot', { method:'POST', body: JSON.stringify({ slot_id: id }) });
    await fetchState();
    setLoading(false);
    toast(`স্লট ${id} আপডেট হয়েছে`);
  } catch(e) { setLoading(false); toast(e.message || 'আপডেট ব্যর্থ হয়েছে','error'); }
}

async function resetAllSlots() {
  if (!confirm('সব স্লট খালি করবেন? বর্তমান বুকিং বাতিল হবে না।')) return;
  setLoading(true,'স্লট রিসেট হচ্ছে...');
  try {
    await api('/api/admin/reset-slots', { method:'POST' });
    await fetchState();
    setLoading(false);
    toast('সব স্লট খালি করা হয়েছে (সক্রিয় বুকিং ছাড়া)','success');
  } catch(e) { setLoading(false); toast(e.message || 'রিসেট ব্যর্থ হয়েছে','error'); }
}

let searchQuery='';
function searchBookings(q) { searchQuery=q.toLowerCase(); renderAdminTable(); }

function renderAdminTable() {
  const wrap=document.getElementById('admin-bookings-table');
  if (!wrap) return;
  const statusLabel={confirmed:'নিশ্চিত',expired:'মেয়াদ শেষ',cancelled:'বাতিল'};
  const statusCls={confirmed:'status-confirmed',expired:'status-expired',cancelled:'status-expired'};
  let bks=STATE.bookings;
  if (searchQuery) bks=bks.filter(b=>b.id.toLowerCase().includes(searchQuery)||b.carNumber.toLowerCase().includes(searchQuery)||b.ownerName.toLowerCase().includes(searchQuery)||b.slotId.toLowerCase().includes(searchQuery));
  if (!bks.length){wrap.innerHTML='<p style="text-align:center;color:var(--text-muted);padding:1.5rem">কোনো বুকিং পাওয়া যায়নি</p>';return;}
  wrap.innerHTML=`<table><thead><tr>
    <th>বুকিং আইডি</th><th>স্লট</th><th>গাড়ি</th><th>মালিক</th><th>সময়কাল</th>
    <th>পেমেন্ট</th><th>মোট</th><th>মেয়াদ</th><th>স্ট্যাটাস</th><th>অ্যাকশন</th>
  </tr></thead><tbody>
  ${bks.slice().reverse().map(b=>{
    const isActive=b.status==='confirmed';
    const left=isActive?getTimeLeft(b.expiresAt):'—';
    const expColor=isActive&&(b.expiresAt-Date.now()<600000)?'color:var(--danger)':'';
    return `<tr>
      <td><code style="font-size:.75rem">${b.id}</code></td>
      <td><strong>${b.slotId}</strong></td>
      <td>${b.carNumber}</td>
      <td>${b.ownerName}<br><small style="color:var(--text-muted)">${b.ownerPhone}</small></td>
      <td>${b.duration}ঘণ্টা<br><small style="color:var(--text-muted)">${new Date(b.createdAt).toLocaleDateString('bn-BD')}</small></td>
      <td>${PAY_NAMES[b.paymentMethod]||b.paymentMethod}</td>
      <td><strong>৳ ${b.price}</strong></td>
      <td style="${expColor};font-family:monospace;font-size:.8rem">${left}</td>
      <td><span class="status-badge ${statusCls[b.status]||'status-pending'}">${statusLabel[b.status]||b.status}</span></td>
      <td>${isActive?`<button class="btn-small danger" onclick="cancelBooking('${b.id}')">বাতিল</button>`:'<span style="color:var(--text-muted);font-size:.78rem">—</span>'}</td>
    </tr>`;
  }).join('')}
  </tbody></table>`;
}

async function cancelBooking(id) {
  if (!confirm('এই বুকিং বাতিল করবেন?')) return;
  setLoading(true,'বাতিল করা হচ্ছে...');
  try {
    await api(`/api/cancel-booking/${id}`, { method:'POST' });
    await fetchState();
    setLoading(false);
    toast('বুকিং বাতিল করা হয়েছে','warning');
  } catch(e) { setLoading(false); toast(e.message || 'বাতিল করতে সমস্যা হয়েছে','error'); }
}

function exportBookings() {
  window.open(API_BASE + '/api/admin/export-csv', '_blank');
  toast('CSV ডাউনলোড শুরু হচ্ছে 📊','success');
}

/* =====================================================
   INIT — backend এর সাথে সংযোগ, পোলিং চালু
   ===================================================== */
async function init() {
  loadTheme();
  const splashText = document.getElementById('splash-text');

  try {
    if (splashText) splashText.textContent = 'সার্ভারে সংযোগ হচ্ছে...';
    await fetchState();
    startPolling();
    if (splashText) splashText.textContent = 'প্রস্তুত!';
  } catch (e) {
    console.error('Init error:', e);
    if (splashText) splashText.textContent = 'সংযোগ ব্যর্থ — সার্ভার চেক করুন';
    setSyncStatus(false);
    toast('সার্ভারে সংযোগ করা যাচ্ছে না','error');
  }

  const params=new URLSearchParams(window.location.search);
  setTimeout(()=>{
    const splash=document.getElementById('splash');
    if (splash) splash.classList.add('hidden');
    setTimeout(()=>{if(splash)splash.remove();},600);
  },1200);

  if (params.get('lot')) {
    toast('QR স্ক্যান সফল! বুকিং পেজে স্বাগতম। 🎉','success');
    showSection('booking');
  } else {
    showSection('home');
  }
}

init();