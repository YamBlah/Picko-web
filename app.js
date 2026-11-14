// ===== 상태 =====
let MEET_POINT = { lat: 37.49793, lng: 127.02757 };
let VEHICLE_POS = null;     // 차량이 실제로 좌표 쏴야 설정됨
let MY_POS = null;          // 탑승자가 위치 공유 시작해야 설정됨
let sessionInfo = null;

// 평균 속도 (라이브 ETA 계산용). 서울 도심 가정.
const WALK_M_PER_MIN  = 75;    // 4.5 km/h
const DRIVE_M_PER_MIN = 400;   // 24 km/h

// Haversine 거리 (m)
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad)
          * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 차량이 실제로 좌표 쏘기 시작했는지 (초기 placeholder 상태 구분용)
let vehicleEverReceived = false;

function updateVehicleEta() {
  if (!vehicleEverReceived) return;   // 운전자 운행 시작 전엔 "—" 유지
  const vDist = haversineM(VEHICLE_POS.lat, VEHICLE_POS.lng, MEET_POINT.lat, MEET_POINT.lng);
  const vMin = Math.max(1, Math.round(vDist / DRIVE_M_PER_MIN));
  const etaEl = document.querySelector('.eta-value');
  if (etaEl) etaEl.textContent = `${vMin}분`;
}

function updateWalkEta() {
  if (!MY_POS) return;
  const wDist = haversineM(MY_POS.lat, MY_POS.lng, MEET_POINT.lat, MEET_POINT.lng);
  const wMin = Math.round(wDist / WALK_M_PER_MIN);
  let text;
  if (wMin >= 60) {
    const h = Math.floor(wMin / 60);
    const m = wMin % 60;
    text = m > 0 ? `도보 약 ${h}시간 ${m}분` : `도보 약 ${h}시간`;
  } else {
    text = `도보 약 ${Math.max(1, wMin)}분`;
  }
  // 바텀시트 + 지도 마커 라벨 동시 갱신
  const walkEl = document.querySelector('.pickup-meta .walk');
  if (walkEl) walkEl.textContent = text;
  const meetSub = document.querySelector('[data-role="meet-sub"]');
  if (meetSub) meetSub.textContent = text;
}

let map;
let vehicleMarker, meMarker, meetMarker, pathLine;

// ===== 세션 부트스트랩 =====
(async function bootstrap() {
  const params = new URLSearchParams(location.search);
  const token = params.get('t');

  try {
    if (token) {
      const res = await fetch('/api/sessions/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ token }),
      });

      if (res.ok) {
        sessionInfo = await res.json();
      } else {
        const body = await res.text();
        const meRes = await fetch('/api/sessions/me', { credentials: 'same-origin' });
        if (meRes.ok) sessionInfo = await meRes.json();
        else throw new Error('redeem_failed: ' + body);
      }
      history.replaceState(null, '', location.pathname);
    } else {
      const res = await fetch('/api/sessions/me', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('no_session');
      sessionInfo = await res.json();
    }

    applySessionInfo(sessionInfo);
    kakao.maps.load(initMap);
  } catch (e) {
    showExpired(e.message);
  }
})();

function applySessionInfo(s) {
  MEET_POINT = { lat: s.pickupLat, lng: s.pickupLng };
  const q = (sel) => document.querySelector(sel);
  if (q('.vehicle-model') && s.vehicleModel) q('.vehicle-model').textContent = s.vehicleModel;
  if (q('.vehicle-plate') && s.vehiclePlate) q('.vehicle-plate').textContent = s.vehiclePlate;
  if (q('.vehicle-color') && s.vehicleColor) q('.vehicle-color').textContent = `차량 색상 · ${s.vehicleColor}`;
  if (q('.pickup-name')  && s.pickupName)   q('.pickup-name').textContent  = s.pickupName;

  // 차량 ETA — 세션 생성 시 추정값을 초기 표시로. 차량이 실제 좌표 쏘기 시작하면 updateVehicleEta 가 덮어씀.
  // (세션 생성 시 운전자가 지정한 "차량 위치 → 픽업지점" 기준이라 운전자 쪽 추정으로 유효함)
  if (s.vehicleEtaMin != null) {
    const etaEl = q('.eta-value');
    if (etaEl) etaEl.textContent = `${Math.max(1, Math.round(s.vehicleEtaMin))}분`;
  }

  // 도보 ETA 는 탑승자 실제 위치가 들어와야 의미 있음 (세션 저장값은 운전자가 가정한 값).
  // 지도 마커 label-sub 초기 상태도 "위치 공유 전" 로 통일
  const meetSub = q('[data-role="meet-sub"]');
  if (meetSub) meetSub.textContent = '위치 공유 전';
}

function showExpired(reason) {
  document.body.innerHTML = `
    <div class="expired">
      <div class="emoji">🔗</div>
      <div class="title">링크가 만료되었거나 유효하지 않아요</div>
      <div class="desc">운전자에게 새 링크를 요청해 주세요.</div>
      <div class="reason">(${reason})</div>
    </div>`;
}

// ===== 지도 초기화 =====
function initMap() {
  const center = new kakao.maps.LatLng(MEET_POINT.lat, MEET_POINT.lng);
  map = new kakao.maps.Map(document.getElementById('map'), { center, level: 4 });

  drawMeetMarker();   // 픽업 지점은 세션에 포함되어 있으니 바로 그림
  // 차량 / 탑승자 마커는 실제 좌표 수신 시 lazy 생성

  document.getElementById('recenterBtn').addEventListener('click', () => {
    if (MY_POS) {
      map.panTo(new kakao.maps.LatLng(MY_POS.lat, MY_POS.lng));
      map.setLevel(3);
    } else {
      map.panTo(new kakao.maps.LatLng(MEET_POINT.lat, MEET_POINT.lng));
    }
  });

  // 범례 클릭 → 해당 마커로 pan
  document.querySelectorAll('.legend-item').forEach((el) => {
    el.addEventListener('click', () => {
      const target = el.dataset.target;
      let pos = null;
      if (target === 'vehicle' && VEHICLE_POS) pos = VEHICLE_POS;
      else if (target === 'me' && MY_POS) pos = MY_POS;
      else if (target === 'meet') pos = MEET_POINT;
      if (pos) {
        map.panTo(new kakao.maps.LatLng(pos.lat, pos.lng));
      } else {
        // 아직 좌표 없는 경우 (차량 운행 전 / 위치 공유 전)
        el.animate([
          { transform: 'translateX(0)' },
          { transform: 'translateX(-3px)' },
          { transform: 'translateX(3px)' },
          { transform: 'translateX(0)' },
        ], { duration: 180 });
      }
    });
  });

  connectWebSocket();
}

// ===== 마커 (디자인 시스템) =====
function makeVehicleMarkerContent() {
  const wrap = document.createElement('div');
  wrap.className = 'marker-combined';
  wrap.innerHTML = `
    <div class="marker-badge vehicle">
      <div class="vehicle-halo"><img src="assets/vehicle_radial_halo.svg" alt=""/></div>
      <img src="assets/ic_driver_marker.svg" alt=""/>
    </div>
    <div class="marker-label">
      <div class="label-title">픽업 차량</div>
      <div class="label-sub">현재 위치</div>
    </div>`;
  return wrap;
}

function makePedestrianMarkerContent() {
  const wrap = document.createElement('div');
  wrap.className = 'marker-combined';
  wrap.innerHTML = `
    <div class="marker-badge pedestrian">
      <img src="assets/ic_pedestrian_marker.svg" alt=""/>
    </div>
    <div class="marker-label">
      <div class="label-title">탑승자</div>
      <div class="label-sub">픽업 지점으로 이동 중</div>
    </div>`;
  return wrap;
}

const SVG_MARKER_PICKUP = `
<svg width="44.88" height="44.88" viewBox="0 0 44.88 44.88" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g filter="url(#f_pk)">
    <g clip-path="url(#c_pk)">
      <rect x="7.92" y="5.94" width="29.04" height="29.04" rx="14.52" fill="#416DE9"/>
      <circle cx="22.44" cy="20.46" r="18.15" fill="#2385F5" stroke-width="0.66" stroke="#2385F5"/>
      <path d="M22.44 26.73C22.44 26.73 17.49 21.78 17.49 19.14C17.49 17.8272 18.0115 16.5681 18.9398 15.6398C19.8681 14.7115 21.1272 14.19 22.44 14.19C23.7528 14.19 25.0119 14.7115 25.9402 15.6398C26.8685 16.5681 27.39 17.8272 27.39 19.14C27.39 21.78 22.44 26.73 22.44 26.73Z" fill="white"/>
      <path d="M22.44 21.12C23.5335 21.12 24.42 20.2335 24.42 19.14C24.42 18.0465 23.5335 17.16 22.44 17.16C21.3465 17.16 20.46 18.0465 20.46 19.14C20.46 20.2335 21.3465 21.12 22.44 21.12Z" fill="#416DE9"/>
    </g>
    <rect x="8.58" y="6.6" width="27.72" height="27.72" rx="13.86" stroke="white" stroke-width="1.32"/>
  </g>
  <defs>
    <filter id="f_pk" x="0" y="0" width="44.88" height="44.88" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feFlood flood-opacity="0" result="BG"/>
      <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hA"/>
      <feOffset dy="1.98"/>
      <feGaussianBlur stdDeviation="3.96"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.08 0"/>
      <feBlend mode="normal" in2="BG" result="shadow"/>
      <feBlend mode="normal" in="SourceGraphic" in2="shadow"/>
    </filter>
    <clipPath id="c_pk"><rect x="7.92" y="5.94" width="29.04" height="29.04" rx="14.52" fill="white"/></clipPath>
  </defs>
</svg>`;

function makeMeetMarkerContent(subText = '추천 픽업 위치') {
  const wrap = document.createElement('div');
  wrap.className = 'marker-combined';
  wrap.innerHTML = `
    <div class="marker-pickup-badge">${SVG_MARKER_PICKUP}</div>
    <div class="marker-label">
      <div class="label-title">${subText}</div>
      <div class="label-sub" data-role="meet-sub">위치 공유 전</div>
    </div>`;
  return wrap;
}

function drawVehicleMarker() {
  if (vehicleMarker || !VEHICLE_POS) return;
  vehicleMarker = new kakao.maps.CustomOverlay({
    position: new kakao.maps.LatLng(VEHICLE_POS.lat, VEHICLE_POS.lng),
    content: makeVehicleMarkerContent(),
    xAnchor: 0.5, yAnchor: 0.5, zIndex: 3,
  });
  vehicleMarker.setMap(map);
}

function drawMeetMarker() {
  const label = (sessionInfo && sessionInfo.pickupName) ? sessionInfo.pickupName : '픽업 지점';
  meetMarker = new kakao.maps.CustomOverlay({
    position: new kakao.maps.LatLng(MEET_POINT.lat, MEET_POINT.lng),
    content: makeMeetMarkerContent(label),
    xAnchor: 0.5, yAnchor: 0.5, zIndex: 4,
  });
  meetMarker.setMap(map);
}

function drawMeMarker() {
  if (meMarker || !MY_POS) return;
  meMarker = new kakao.maps.CustomOverlay({
    position: new kakao.maps.LatLng(MY_POS.lat, MY_POS.lng),
    content: makePedestrianMarkerContent(),
    xAnchor: 0.5, yAnchor: 0.5, zIndex: 2,
  });
  meMarker.setMap(map);
}

// ===== WebSocket =====
let ws = null;
let wsReconnectTimer = null;

function connectWebSocket() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${scheme}://${location.host}/ws/pedestrian`;
  try { ws?.close(); } catch {}
  ws = new WebSocket(url);
  ws.addEventListener('message', (ev) => {
    try { handleWsMessage(JSON.parse(ev.data)); } catch {}
  });
  ws.addEventListener('close', scheduleReconnect);
  ws.addEventListener('error', () => {});
}
function scheduleReconnect() {
  clearTimeout(wsReconnectTimer);
  wsReconnectTimer = setTimeout(connectWebSocket, 2000);
}
function handleWsMessage(msg) {
  switch (msg.type) {
    case 'vehicle_location':
      VEHICLE_POS = { lat: msg.lat, lng: msg.lng };
      drawVehicleMarker();
      vehicleMarker?.setPosition(new kakao.maps.LatLng(msg.lat, msg.lng));
      vehicleEverReceived = true;
      updateVehicleEta();
      break;
    case 'eta':
      const etaEl = document.querySelector('.eta-value');
      if (etaEl && msg.minutes != null) etaEl.textContent = `${msg.minutes}분`;
      break;
    case 'session_canceled':
      handleCanceled(msg.reason);
      break;
  }
}

// ===== 취소 처리 =====
function handleCanceled(reason) {
  // 위치 공유 중지
  if (geoWatchId !== null) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
  }
  // WebSocket 닫기 (재연결 X)
  clearTimeout(wsReconnectTimer);
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  // 전체 화면 알림
  document.body.innerHTML = `
    <div class="expired">
      <div class="emoji">🚫</div>
      <div class="title">운전자 요청으로 픽업이 취소되었어요</div>
      <div class="desc">다시 이용하려면 운전자에게 새 링크를 요청해 주세요.</div>
      ${reason ? `<div class="reason">(${reason})</div>` : ''}
    </div>`;
}

// ===== 바텀시트 드래그 =====
(function setupDraggableSheet() {
  const sheet = document.getElementById('sheet');
  const handle = document.getElementById('dragHandle');
  if (!sheet || !handle) return;

  const SNAP = () => {
    const vh = window.innerHeight;
    return {
      collapsed: 72,
      default: 345,
      expanded: Math.floor(vh * 0.85),
    };
  };

  function setHeight(h) {
    sheet.style.height = `${h}px`;
    document.documentElement.style.setProperty('--sheet-height', `${h}px`);
  }

  let dragging = false;
  let startY = 0;
  let startH = 0;
  let moved = false;

  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = false;
    startY = e.clientY;
    startH = sheet.offsetHeight;
    sheet.style.transition = 'none';
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = startY - e.clientY;
    if (Math.abs(dy) > 3) moved = true;
    const snap = SNAP();
    const h = Math.max(snap.collapsed, Math.min(snap.expanded, startH + dy));
    setHeight(h);
  });

  function snapTo(current) {
    const snap = SNAP();
    const candidates = [snap.collapsed, snap.default, snap.expanded];
    const target = candidates.reduce((best, c) =>
      Math.abs(c - current) < Math.abs(best - current) ? c : best
    );
    sheet.style.transition = 'height 0.3s cubic-bezier(0.32, 0.72, 0, 1)';
    setHeight(target);
  }

  handle.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture?.(e.pointerId);
    if (!moved) {
      // 탭 — collapsed ↔ default 토글
      const snap = SNAP();
      const current = sheet.offsetHeight;
      const target = current <= snap.collapsed + 30 ? snap.default : snap.collapsed;
      sheet.style.transition = 'height 0.3s cubic-bezier(0.32, 0.72, 0, 1)';
      setHeight(target);
    } else {
      snapTo(sheet.offsetHeight);
    }
  });

  handle.addEventListener('pointercancel', () => {
    if (!dragging) return;
    dragging = false;
    snapTo(sheet.offsetHeight);
  });

  // 초기 CSS 변수 세팅
  setHeight(SNAP().default);
})();

// ===== Geolocation =====
let geoWatchId = null;

const ctaBtn   = document.querySelector('.cta-btn');
const ctaLabel = ctaBtn.querySelector('span');
const ctaIcon  = ctaBtn.querySelector('.cta-icon');

ctaBtn.addEventListener('click', startSharingLocation);

function setBtnSharing() {
  ctaBtn.classList.add('sharing');
  ctaBtn.disabled = true;
  ctaIcon.src = 'assets/ic_pin_check_sharing.svg';
  ctaLabel.textContent = '내 위치 공유 중';
}

function setBtnDefault(label) {
  ctaBtn.classList.remove('sharing');
  ctaBtn.disabled = false;
  ctaIcon.src = 'assets/ic_send.svg';
  ctaLabel.textContent = label ?? '운전자에게 내 위치 보내기';
}

function startSharingLocation() {
  if (!('geolocation' in navigator)) {
    showGeoError('이 브라우저는 위치 기능을 지원하지 않습니다.');
    return;
  }
  if (geoWatchId !== null) return;

  ctaLabel.textContent = '위치 조회 중…';
  ctaBtn.disabled = true;

  geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      MY_POS = { lat, lng };
      drawMeMarker();
      meMarker?.setPosition(new kakao.maps.LatLng(lat, lng));
      updateWalkEta();     // 내 위치 기반 도보 ETA 재계산

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'pedestrian_location', lat, lng }));
        setBtnSharing();
      } else {
        ctaLabel.textContent = '연결 대기 중…';
      }
    },
    (err) => {
      setBtnDefault('다시 시도');
      showGeoError(geoErrorDetail(err));
      geoWatchId = null;
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
  );
}

function geoErrorDetail(err) {
  switch (err.code) {
    case 1: return '위치 권한이 거부되었습니다.\n설정 > 위치 서비스 허용 후 재시도';
    case 2: return '위치 정보를 가져올 수 없음.\nWi-Fi/GPS 가 꺼져있는지 확인';
    case 3: return '위치 조회 시간 초과 — 다시 시도';
    default: return err.message || '알 수 없는 오류';
  }
}

function showGeoError(msg) {
  let banner = document.querySelector('.geo-error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'geo-error-banner';
    document.querySelector('.sheet').prepend(banner);
  }
  banner.textContent = msg;
}
