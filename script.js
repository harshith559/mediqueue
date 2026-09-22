/* ============================================================
   MediQueue — app logic
   Priority queue per department, persisted to localStorage.
   Priority order: Emergency > Urgent > Normal, FIFO within tier.
   ============================================================ */

const DEPARTMENTS = ["General", "Cardiology", "Pediatrics", "Orthopedics"];
const DEPT_PREFIX = { General: "G", Cardiology: "C", Pediatrics: "P", Orthopedics: "O" };
const PRIORITY_RANK = { Emergency: 0, Urgent: 1, Normal: 2 };
const AVG_MINUTES_PER_PATIENT = 8;
const STORAGE_KEY = "mediqueue_state_v1";

/* ---------- State ---------- */
// state.tickets: array of { id, number, name, dept, reason, severity, status, createdAt }
// status: "waiting" | "serving" | "done"
// state.counters: per-department running ticket number
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to load MediQueue state:", e);
  }
  return { tickets: [], counters: Object.fromEntries(DEPARTMENTS.map(d => [d, 0])) };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Failed to save MediQueue state:", e);
  }
}

let state = loadState();

/* ---------- Ticket creation ---------- */
function createTicket({ name, dept, reason, severity }) {
  state.counters[dept] = (state.counters[dept] || 0) + 1;
  const number = `${DEPT_PREFIX[dept]}-${String(state.counters[dept]).padStart(3, "0")}`;
  const ticket = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    number,
    name: name.trim(),
    dept,
    reason: reason.trim(),
    severity,
    status: "waiting",
    createdAt: Date.now(),
  };
  state.tickets.push(ticket);
  saveState();
  return ticket;
}

/* ---------- Queue queries ---------- */
function waitingFor(dept) {
  return state.tickets
    .filter(t => t.dept === dept && t.status === "waiting")
    .sort((a, b) => PRIORITY_RANK[a.severity] - PRIORITY_RANK[b.severity] || a.createdAt - b.createdAt);
}

function servingFor(dept) {
  return state.tickets.find(t => t.dept === dept && t.status === "serving") || null;
}

function callNext(dept) {
  const current = servingFor(dept);
  if (current) current.status = "done";
  const queue = waitingFor(dept);
  if (queue.length === 0) { saveState(); return null; }
  queue[0].status = "serving";
  saveState();
  return queue[0];
}

function completeCurrent(dept) {
  const current = servingFor(dept);
  if (current) {
    current.status = "done";
    saveState();
  }
}

function estimatedWaitMinutes(dept, position) {
  // position is 0-indexed within the waiting list
  return (position + 1) * AVG_MINUTES_PER_PATIENT;
}

/* ============================================================
   View switching
   ============================================================ */
const tabs = document.querySelectorAll(".tab");
const views = document.querySelectorAll(".view");

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.view;
    tabs.forEach(t => { t.classList.toggle("is-active", t === tab); t.setAttribute("aria-selected", t === tab); });
    views.forEach(v => v.classList.toggle("is-active", v.id === `view-${target}`));
    if (target === "board") renderBoard();
    if (target === "staff") renderStaff();
  });
});

/* ============================================================
   Toast
   ============================================================ */
const toastEl = document.getElementById("toast");
let toastTimer = null;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 2600);
}

/* ============================================================
   Check-in form
   ============================================================ */
const checkinForm = document.getElementById("checkin-form");
const ticketPreview = document.getElementById("ticket-preview");

checkinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("patient-name").value;
  const dept = document.getElementById("patient-dept").value;
  const reason = document.getElementById("patient-reason").value;
  const severity = checkinForm.querySelector('input[name="severity"]:checked').value;

  if (!name.trim()) return;

  const ticket = createTicket({ name, dept, reason, severity });
  const position = waitingFor(dept).findIndex(t => t.id === ticket.id);
  const wait = estimatedWaitMinutes(dept, position);

  ticketPreview.classList.remove("is-issued");
  // force reflow so the pop animation can replay
  void ticketPreview.offsetWidth;
  ticketPreview.innerHTML = `
    <span class="ticket-eyebrow">Your ticket</span>
    <span class="ticket-number">${ticket.number}</span>
    <span class="ticket-dept">${ticket.dept} · ${ticket.name}</span>
    <div class="ticket-meta">
      <span class="ticket-pill">${ticket.severity}</span>
      <span class="ticket-pill">~${wait} min wait</span>
      <span class="ticket-pill">${position + 1} in line</span>
    </div>
  `;
  ticketPreview.classList.add("is-issued");

  showToast(`Ticket ${ticket.number} issued — you're #${position + 1} in ${ticket.dept}`);
  checkinForm.reset();

  // keep board/staff views fresh if user switches tabs later
  renderBoard();
  renderStaff();
});

/* ============================================================
   Live board rendering
   ============================================================ */
const boardGrid = document.getElementById("board-grid");

function renderBoard() {
  boardGrid.innerHTML = DEPARTMENTS.map(dept => {
    const serving = servingFor(dept);
    const queue = waitingFor(dept);
    const upNext = queue.slice(0, 3);

    return `
      <div class="dept-card">
        <h3>${dept} <span class="dept-count-badge">${queue.length} waiting</span></h3>
        <div class="now-serving-label">Now serving</div>
        ${serving
          ? `<div class="now-serving-number">${serving.number}</div>`
          : `<div class="now-serving-empty">No patient called yet</div>`}
        <div class="up-next">
          ${upNext.length === 0
            ? `<div class="queue-empty">Queue is empty</div>`
            : upNext.map((t, i) => `
              <div class="up-next-row">
                <span class="num">${t.number}</span>
                <span class="badge badge-${t.severity}">${t.severity}</span>
                <span>~${estimatedWaitMinutes(dept, i)} min</span>
              </div>
            `).join("")}
        </div>
        <div class="wait-est">Avg. wait: <strong>${AVG_MINUTES_PER_PATIENT} min</strong> per patient</div>
      </div>
    `;
  }).join("");
}

/* ============================================================
   Staff dashboard rendering
   ============================================================ */
const statsRow = document.getElementById("stats-row");
const staffGrid = document.getElementById("staff-grid");

function renderStats() {
  const allWaiting = state.tickets.filter(t => t.status === "waiting");
  const emergencies = allWaiting.filter(t => t.severity === "Emergency").length;
  const servedToday = state.tickets.filter(t => t.status === "done").length;
  const avgWait = allWaiting.length ? Math.round((allWaiting.length * AVG_MINUTES_PER_PATIENT) / DEPARTMENTS.length) : 0;

  statsRow.innerHTML = `
    <div class="stat-card"><div class="stat-num">${allWaiting.length}</div><div class="stat-label">Patients waiting</div></div>
    <div class="stat-card"><div class="stat-num">${emergencies}</div><div class="stat-label">Emergencies in queue</div></div>
    <div class="stat-card"><div class="stat-num">${servedToday}</div><div class="stat-label">Patients served</div></div>
    <div class="stat-card"><div class="stat-num">${avgWait}</div><div class="stat-label">Avg. wait (min)</div></div>
  `;
}

function renderStaff() {
  renderStats();

  staffGrid.innerHTML = DEPARTMENTS.map(dept => {
    const serving = servingFor(dept);
    const queue = waitingFor(dept);

    return `
      <div class="staff-card">
        <div class="staff-card-head">
          <h3>${dept}</h3>
          <span class="dept-count-badge">${queue.length} waiting</span>
        </div>

        ${serving
          ? `<div class="wait-est">Currently serving <strong>${serving.number} — ${serving.name}</strong></div>`
          : `<div class="wait-est">No one currently being served</div>`}

        <ul class="queue-list">
          ${queue.length === 0
            ? `<li class="queue-empty">No patients waiting</li>`
            : queue.map(t => `
              <li class="queue-row">
                <span class="num">${t.number}</span>
                <span class="name">${t.name}</span>
                <span class="badge badge-${t.severity}">${t.severity}</span>
                ${t.reason ? `<span class="reason">${t.reason}</span>` : ""}
              </li>
            `).join("")}
        </ul>

        <div class="staff-actions">
          <button class="btn-call" data-dept="${dept}" ${queue.length === 0 ? "disabled" : ""}>Call next</button>
          <button class="btn-complete" data-dept="${dept}" ${serving ? "" : "disabled"}>Mark done</button>
        </div>
      </div>
    `;
  }).join("");

  staffGrid.querySelectorAll(".btn-call").forEach(btn => {
    btn.addEventListener("click", () => {
      const dept = btn.dataset.dept;
      const called = callNext(dept);
      if (called) showToast(`Calling ${called.number} — ${called.name} to ${dept}`);
      renderStaff();
      renderBoard();
    });
  });

  staffGrid.querySelectorAll(".btn-complete").forEach(btn => {
    btn.addEventListener("click", () => {
      const dept = btn.dataset.dept;
      completeCurrent(dept);
      showToast(`Marked current ${dept} patient as done`);
      renderStaff();
      renderBoard();
    });
  });
}

/* ============================================================
   Keep tabs in sync across browser tabs (multi-device kiosk demo)
   ============================================================ */
window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY) {
    state = loadState();
    renderBoard();
    renderStaff();
  }
});

/* ---------- Initial paint ---------- */
renderBoard();
renderStaff();