import { useState, useEffect, useCallback, useMemo } from "react";

// ─── Constants ───────────────────────────────────────────
const SHIFT_TYPES = {
  work: { label: "出勤", color: "#2563EB", bg: "#EFF6FF", emoji: "○" },
  off: { label: "休み", color: "#9CA3AF", bg: "#F3F4F6", emoji: "×" },
};

const DEFAULT_ADMIN_PASS = "admin1234";

// ─── Utility ─────────────────────────────────────────────
const genId = () => Math.random().toString(36).slice(2, 10);
const getDaysInMonth = (y, m) => new Date(y, m, 0).getDate();
const getDayOfWeek = (y, m, d) => ["日", "月", "火", "水", "木", "金", "土"][new Date(y, m - 1, d).getDay()];
const getDayColor = (y, m, d) => {
  const dow = new Date(y, m - 1, d).getDay();
  if (dow === 0) return "#EF4444";
  if (dow === 6) return "#2563EB";
  return "#374151";
};
const isWeekend = (y, m, d) => {
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 || dow === 6;
};

// Get display name: prefer lastName, fallback to first part of name (for backward compatibility)
const getLastName = (staff) => {
  if (staff.lastName && staff.lastName.trim()) return staff.lastName.trim();
  // Backward compat: extract first part (before space) from old `name` field
  if (staff.name) return staff.name.split(/[\s　]/)[0];
  return "";
};

// Get full display name for staff lists/dropdowns
const getFullName = (staff) => {
  if (staff.lastName || staff.firstName) {
    return `${staff.lastName || ""} ${staff.firstName || ""}`.trim();
  }
  return staff.name || "";
};

const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = now.getMonth() + 1;

// ─── Supabase Client ─────────────────────────────────────
const SUPABASE_URL = "https://pitsuukwownhfhaewugg.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpdHN1dWt3b3duaGZoYWV3dWdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MDYxMjksImV4cCI6MjA5MTk4MjEyOX0.WeV6rbaRYY8J_sbNsDGHSaQuyzpUS0Sf_VB7kzOX1Dk";

const sb = (table) => `${SUPABASE_URL}/rest/v1/${table}`;
const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const api = {
  async get(table, params = "") {
    const res = await fetch(`${sb(table)}?${params}`, { headers });
    if (!res.ok) throw new Error(`GET ${table} failed`);
    return res.json();
  },
  async post(table, data) {
    const res = await fetch(sb(table), {
      method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`POST ${table} failed`);
    return res.json();
  },
  async upsert(table, data) {
    const res = await fetch(sb(table), {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation,resolution=merge-duplicates" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`UPSERT ${table} failed`);
    return res.json();
  },
  async patch(table, params, data) {
    const res = await fetch(`${sb(table)}?${params}`, {
      method: "PATCH", headers, body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`PATCH ${table} failed`);
    return res.json();
  },
  async del(table, params) {
    const res = await fetch(`${sb(table)}?${params}`, { method: "DELETE", headers });
    if (!res.ok) throw new Error(`DELETE ${table} failed`);
  },
};

// Convert DB row to app staff format
const dbToStaff = (row) => ({
  id: row.id,
  lastName: row.last_name,
  firstName: row.first_name || "",
  name: `${row.last_name} ${row.first_name || ""}`.trim(),
  phone: row.phone || "",
  group: row.group,
});

// Convert DB shift row to app format key-value
const dbShiftsToMap = (rows) => {
  const map = {};
  rows.forEach((r) => {
    const key = `${r.staff_id}_${r.year}-${r.month}`;
    map[key] = { staffId: r.staff_id, year: r.year, month: r.month, shifts: r.shifts, submittedAt: r.submitted_at };
  });
  return map;
};

// Convert paren_overrides rows to app format map
const dbParenToMap = (rows) => {
  const map = {};
  rows.forEach((r) => { map[`${r.view_group}_${r.day}_${r.staff_id}`] = true; });
  return map;
};

// Convert event_overrides rows to app format map (keyed by all groups dynamically)
const dbEventToMap = (rows, groupIds) => {
  const map = {};
  rows.forEach((r) => {
    groupIds.forEach((gid) => { map[`${gid}_${r.day}_${r.staff_id}`] = true; });
  });
  return map;
};

// ─── Styles ──────────────────────────────────────────────
const styles = {
  app: {
    fontFamily: "'Noto Sans JP', 'Hiragino Sans', 'Meiryo', sans-serif",
    minHeight: "100vh",
    background: "#F8FAFC",
    color: "#1E293B",
  },
  header: {
    background: "#FFFFFF",
    borderBottom: "3px solid #2563EB",
    padding: "14px 20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    position: "sticky",
    top: 0,
    zIndex: 100,
    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
  },
  logo: {
    fontSize: 18,
    fontWeight: 800,
    color: "#2563EB",
    letterSpacing: "-0.03em",
  },
  container: {
    maxWidth: 960,
    margin: "0 auto",
    padding: "24px 16px",
  },
  card: {
    background: "#FFFFFF",
    borderRadius: 12,
    border: "1px solid #E2E8F0",
    padding: 24,
    marginBottom: 16,
    boxShadow: "0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)",
  },
  btn: (color = "#2563EB", outline = false) => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "12px 24px",
    borderRadius: 10,
    border: outline ? `2px solid ${color}` : "none",
    background: outline ? "#FFFFFF" : color,
    color: outline ? color : "#FFFFFF",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s ease",
    fontFamily: "inherit",
    minHeight: 48,
    boxShadow: outline ? "none" : "0 1px 3px rgba(0,0,0,0.1)",
  }),
  btnSm: (color = "#2563EB", outline = false) => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    padding: "8px 16px",
    borderRadius: 8,
    border: outline ? `1.5px solid ${color}` : "none",
    background: outline ? "#FFFFFF" : color,
    color: outline ? color : "#FFFFFF",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s ease",
    fontFamily: "inherit",
    minHeight: 36,
  }),
  input: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 8,
    border: "1.5px solid #CBD5E1",
    fontSize: 15,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  },
  select: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 8,
    border: "1.5px solid #CBD5E1",
    fontSize: 15,
    fontFamily: "inherit",
    outline: "none",
    background: "#FFFFFF",
    boxSizing: "border-box",
    cursor: "pointer",
  },
  badge: (color) => ({
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    background: color + "18",
    color: color,
  }),
  backBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "6px 12px",
    borderRadius: 6,
    border: "none",
    background: "transparent",
    color: "#64748B",
    fontSize: 14,
    cursor: "pointer",
    fontFamily: "inherit",
  },
};

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 8mm; }
  body * { visibility: hidden !important; }
  #print-area, #print-area * { visibility: visible !important; }
  #print-area { position: absolute !important; left: 0; top: 0; width: 100%; background: white !important; }
  .no-print { display: none !important; }
  .page-break { page-break-before: always; }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes slideIn {
  from { opacity: 0; transform: translateX(-12px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes popIn {
  0% { transform: scale(0.8); opacity: 0; }
  70% { transform: scale(1.05); }
  100% { transform: scale(1); opacity: 1; }
}
.fade-in { animation: fadeIn 0.3s ease-out both; }
.fade-in-d1 { animation: fadeIn 0.3s ease-out 0.05s both; }
.fade-in-d2 { animation: fadeIn 0.3s ease-out 0.1s both; }
.fade-in-d3 { animation: fadeIn 0.3s ease-out 0.15s both; }
.slide-in { animation: slideIn 0.25s ease-out both; }
.scale-in { animation: scaleIn 0.2s ease-out both; }
.pop-in { animation: popIn 0.35s ease-out both; }
`;

// ─── Components ──────────────────────────────────────────
function Header({ title, onBack, rightAction }) {
  return (
    <div style={styles.header} className="no-print">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {onBack && (
          <button style={styles.backBtn} onClick={onBack}>
            ← 戻る
          </button>
        )}
        <span style={styles.logo}>{title || "DS シフト管理"}</span>
      </div>
      {rightAction && <div>{rightAction}</div>}
    </div>
  );
}

function MonthSelector({ year, month, onChange }) {
  const prev = () => {
    if (month === 1) onChange(year - 1, 12);
    else onChange(year, month - 1);
  };
  const next = () => {
    if (month === 12) onChange(year + 1, 1);
    else onChange(year, month + 1);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "center", margin: "8px 0 16px" }}>
      <button style={styles.btnSm("#64748B", true)} onClick={prev}>◀</button>
      <span style={{ fontSize: 18, fontWeight: 700, minWidth: 120, textAlign: "center" }}>
        {year}年 {month}月
      </span>
      <button style={styles.btnSm("#64748B", true)} onClick={next}>▶</button>
    </div>
  );
}

// ─── TOP PAGE ────────────────────────────────────────────
function TopPage({ onNavigate }) {
  return (
    <>
      <Header />
      <div style={styles.container}>
        <div style={{ textAlign: "center", padding: "40px 0 32px" }} className="fade-in">
          <div style={{ fontSize: 40, marginBottom: 8 }} className="pop-in">📅</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px", color: "#1E293B" }}>
            DSシフト管理
          </h1>
          <p style={{ color: "#64748B", fontSize: 14, margin: 0 }}>
            シフトの提出・確認がかんたんにできます
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 400, margin: "0 auto" }}>
          <button
            className="fade-in-d1"
            style={{ ...styles.btn("#2563EB"), padding: "20px 24px", fontSize: 17, borderRadius: 14 }}
            onClick={() => onNavigate("staffSelect")}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(37,99,235,0.3)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)"; }}
          >
            📝 スタッフ用（シフト提出）
          </button>
          <button
            className="fade-in-d2"
            style={{ ...styles.btn("#475569"), padding: "20px 24px", fontSize: 17, borderRadius: 14 }}
            onClick={() => onNavigate("adminLogin")}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(71,85,105,0.3)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)"; }}
          >
            🔒 管理者用
          </button>
        </div>
      </div>
    </>
  );
}

// ─── STAFF SELECT ────────────────────────────────────────
function StaffSelectPage({ staffList, groups, onSelect, onBack }) {
  const grouped = useMemo(() => {
    const g = {};
    groups.forEach((gr) => { g[gr.id] = []; });
    staffList.forEach((s) => { if (g[s.group]) g[s.group].push(s); });
    return g;
  }, [staffList, groups]);

  return (
    <>
      <Header title="名前を選択" onBack={onBack} />
      <div style={styles.container}>
        {staffList.length === 0 ? (
          <div style={{ ...styles.card, textAlign: "center", color: "#64748B" }}>
            <p style={{ fontSize: 16 }}>スタッフが登録されていません</p>
            <p style={{ fontSize: 13 }}>管理者にスタッフ登録を依頼してください</p>
          </div>
        ) : (
          groups.map((gr) => (
            <div key={gr.id} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#64748B", marginBottom: 8, paddingLeft: 4 }}>
                {gr.name}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {grouped[gr.id]?.map((staff) => (
                  <button
                    key={staff.id}
                    style={{
                      ...styles.card,
                      marginBottom: 0, padding: "16px 20px", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      border: "1.5px solid #E2E8F0", transition: "all 0.12s", textAlign: "left",
                      fontFamily: "inherit", fontSize: 16, fontWeight: 500, color: "#1E293B", background: "#FFFFFF",
                    }}
                    onClick={() => onSelect(staff)}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#2563EB"; e.currentTarget.style.background = "#F8FAFF"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#E2E8F0"; e.currentTarget.style.background = "#FFFFFF"; }}
                  >
                    <span>{getFullName(staff)}</span>
                    <span style={{ color: "#94A3B8", fontSize: 14 }}>→</span>
                  </button>
                ))}
                {(!grouped[gr.id] || grouped[gr.id].length === 0) && (
                  <div style={{ color: "#94A3B8", fontSize: 13, paddingLeft: 4 }}>スタッフなし</div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ─── SHIFT INPUT ─────────────────────────────────────────
function ShiftInputPage({ staff, year, month, existingShifts, onSubmit, onBack, onChangeMonth, deadline, isLocked }) {
  const days = getDaysInMonth(year, month);
  const [shifts, setShifts] = useState({});

  useEffect(() => {
    if (existingShifts) setShifts(existingShifts);
    else setShifts({});
  }, [existingShifts, year, month]);

  const toggle = (d) => {
    if (isLocked) return;
    setShifts((prev) => {
      const cur = prev[d];
      if (!cur) return { ...prev, [d]: "work" };
      const next = { ...prev };
      delete next[d];
      return next;
    });
  };

  const filledCount = Object.keys(shifts).length;

  return (
    <>
      <Header title={`${getFullName(staff)} さんのシフト`} onBack={onBack} />
      <div style={styles.container}>
        <MonthSelector year={year} month={month} onChange={onChangeMonth} />

        {/* Deadline info */}
        {deadline && (
          <div style={{
            ...styles.card, padding: "12px 16px", marginBottom: 12,
            background: isLocked ? "#FEF2F2" : "#FFFBEB",
            borderColor: isLocked ? "#FECACA" : "#FDE68A",
          }}>
            <div style={{ fontSize: 13, color: isLocked ? "#DC2626" : "#92400E", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 16 }}>{isLocked ? "🔒" : "⏰"}</span>
              {isLocked ? (
                <span><strong>提出期限を過ぎています</strong>（期限: {deadline}）。変更が必要な場合は管理者にご連絡ください。</span>
              ) : (
                <span>提出期限: <strong>{deadline}</strong></span>
              )}
            </div>
          </div>
        )}

        <div style={{ ...styles.card, padding: 16, opacity: isLocked ? 0.6 : 1 }}>
          <div style={{ fontSize: 13, color: "#64748B", marginBottom: 12, textAlign: "center" }}>
            {isLocked ? "提出期限を過ぎているため編集できません" : "日付をタップして「出勤 ○ → 未入力」を切り替え"}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 8 }}>
            {["日", "月", "火", "水", "木", "金", "土"].map((d, i) => (
              <div key={d} style={{
                textAlign: "center", fontSize: 12, fontWeight: 600, padding: "4px 0",
                color: i === 0 ? "#EF4444" : i === 6 ? "#2563EB" : "#64748B",
              }}>
                {d}
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
            {Array.from({ length: new Date(year, month - 1, 1).getDay() }, (_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const d = i + 1;
              const val = shifts[d];
              const st = val ? SHIFT_TYPES[val] : null;
              const weekend = isWeekend(year, month, d);
              return (
                <button
                  key={d}
                  onClick={() => toggle(d)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "8px 2px",
                    borderRadius: 8,
                    border: val ? `2px solid ${st.color}` : "1.5px solid #E2E8F0",
                    background: val ? st.bg : weekend ? "#FAFAFA" : "#FFFFFF",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 0.1s",
                    minHeight: 56,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: getDayColor(year, month, d) }}>{d}</span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: st?.color || "transparent", marginTop: 2 }}>
                    {st?.emoji || "ー"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: "#64748B" }}>
            入力済み: {filledCount} / {days} 日
          </span>
          <div style={{ display: "flex", gap: 12, fontSize: 13 }}>
            <span style={{ color: SHIFT_TYPES.work.color }}>○ 出勤</span>
            <span style={{ color: "#CBD5E1" }}>ー 未入力</span>
          </div>
        </div>

        <button
          style={{ ...styles.btn(isLocked ? "#94A3B8" : "#2563EB"), width: "100%", cursor: isLocked ? "not-allowed" : "pointer" }}
          onClick={() => !isLocked && onSubmit(shifts)}
          disabled={isLocked}
        >
          {isLocked ? "🔒 提出期限が過ぎています" : "✓ シフトを提出する"}
        </button>
      </div>
    </>
  );
}

// ─── SUBMIT COMPLETE ─────────────────────────────────────
function CompletePage({ staff, onBack }) {
  return (
    <>
      <Header title="提出完了" />
      <div style={styles.container}>
        <div style={{ ...styles.card, textAlign: "center", padding: "48px 24px" }} className="scale-in">
          <div style={{ fontSize: 48, marginBottom: 16 }} className="pop-in">✅</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px", color: "#1E293B" }}>
            シフトを提出しました！
          </h2>
          <p style={{ color: "#64748B", fontSize: 14, margin: "0 0 32px" }}>
            {getFullName(staff)} さんのシフトが保存されました
          </p>
          <button style={styles.btn("#2563EB")} onClick={onBack}>
            トップに戻る
          </button>
        </div>
      </div>
    </>
  );
}

// ─── ADMIN LOGIN ─────────────────────────────────────────
function AdminLoginPage({ onLogin, onBack, adminPass }) {
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");

  const handleLogin = () => {
    if (pass === adminPass) {
      onLogin();
    } else {
      setError("パスワードが違います");
    }
  };

  return (
    <>
      <Header title="管理者ログイン" onBack={onBack} />
      <div style={styles.container}>
        <div style={{ ...styles.card, maxWidth: 400, margin: "40px auto" }} className="fade-in">
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }} className="pop-in">🔒</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>管理者ログイン</h2>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
              パスワード
            </label>
            <input
              type="password"
              style={styles.input}
              value={pass}
              onChange={(e) => { setPass(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder="パスワードを入力"
            />
            {error && <div style={{ color: "#EF4444", fontSize: 13, marginTop: 6 }}>{error}</div>}
          </div>

          <button style={{ ...styles.btn("#2563EB"), width: "100%" }} onClick={handleLogin}>
            ログイン
          </button>
          <p style={{ fontSize: 12, color: "#94A3B8", textAlign: "center", marginTop: 12 }}>
            初期パスワード: admin1234
          </p>
        </div>
      </div>
    </>
  );
}

// ─── ADMIN DASHBOARD ─────────────────────────────────────
function AdminDashboard({ staffList, shiftsData, year, month, onChangeMonth, onNavigate, onLogout, deadlines, onSaveDeadline, onRemoveDeadline, groups }) {
  const [deadlineInput, setDeadlineInput] = useState("");

  const dlKey = `${year}-${month}`;
  const currentDeadline = deadlines[dlKey] || "";

  useEffect(() => {
    setDeadlineInput(currentDeadline);
  }, [currentDeadline]);
  const submitted = useMemo(() => {
    const key = `${year}-${month}`;
    return staffList.filter((s) => shiftsData[`${s.id}_${key}`]);
  }, [staffList, shiftsData, year, month]);

  const notSubmitted = useMemo(() => {
    const key = `${year}-${month}`;
    return staffList.filter((s) => !shiftsData[`${s.id}_${key}`]);
  }, [staffList, shiftsData, year, month]);

  return (
    <>
      <Header
        title="管理者メニュー"
        rightAction={
          <button style={styles.btnSm("#64748B", true)} onClick={onLogout}>
            ログアウト
          </button>
        }
      />
      <div style={styles.container}>
        <MonthSelector year={year} month={month} onChange={onChangeMonth} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
          {[
            { label: "スタッフ数", val: staffList.length, color: "#2563EB" },
            { label: "提出済み", val: submitted.length, color: "#10B981" },
            { label: "未提出", val: notSubmitted.length, color: "#F59E0B" },
          ].map((s) => (
            <div key={s.label} style={{ ...styles.card, textAlign: "center", padding: 16, marginBottom: 0 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          <button
            style={{ ...styles.card, marginBottom: 0, padding: "18px 20px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", border: "1.5px solid #2563EB", fontFamily: "inherit", textAlign: "left", background: "#EFF6FF" }}
            onClick={() => onNavigate("pdfView")}
          >
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#2563EB" }}>📄 PDFカレンダー表示・出力</div>
              <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>両店舗のシフト表をPDFで印刷・保存</div>
            </div>
            <span style={{ color: "#2563EB" }}>→</span>
          </button>

          {groups.map((gr) => (
            <button
              key={gr.id}
              style={{ ...styles.card, marginBottom: 0, padding: "18px 20px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", border: "1.5px solid #E2E8F0", fontFamily: "inherit", textAlign: "left", background: "#FFFFFF" }}
              onClick={() => onNavigate("calendar", gr.id)}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#2563EB"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#E2E8F0"; }}
            >
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#1E293B" }}>📋 {gr.name}（簡易表示）</div>
                <div style={{ fontSize: 13, color: "#64748B", marginTop: 2 }}>スタッフごとの出勤状況を一覧</div>
              </div>
              <span style={{ color: "#94A3B8" }}>→</span>
            </button>
          ))}
          <button
            style={{ ...styles.card, marginBottom: 0, padding: "18px 20px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", border: "1.5px solid #E2E8F0", fontFamily: "inherit", textAlign: "left", background: "#FFFFFF" }}
            onClick={() => onNavigate("staffManage")}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#2563EB"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#E2E8F0"; }}
          >
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#1E293B" }}>👥 スタッフ管理</div>
              <div style={{ fontSize: 13, color: "#64748B", marginTop: 2 }}>追加・編集・連絡先・グループ変更</div>
            </div>
            <span style={{ color: "#94A3B8" }}>→</span>
          </button>
          <button
            style={{ ...styles.card, marginBottom: 0, padding: "18px 20px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", border: "1.5px solid #E2E8F0", fontFamily: "inherit", textAlign: "left", background: "#FFFFFF" }}
            onClick={() => onNavigate("groupManage")}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#2563EB"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#E2E8F0"; }}
          >
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#1E293B" }}>🏪 店舗グループ管理</div>
              <div style={{ fontSize: 13, color: "#64748B", marginTop: 2 }}>店舗の追加・編集・削除</div>
            </div>
            <span style={{ color: "#94A3B8" }}>→</span>
          </button>
          <button
            style={{ ...styles.card, marginBottom: 0, padding: "18px 20px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", border: "1.5px solid #E2E8F0", fontFamily: "inherit", textAlign: "left", background: "#FFFFFF" }}
            onClick={() => onNavigate("changePass")}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#2563EB"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#E2E8F0"; }}
          >
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#1E293B" }}>🔑 パスワード変更</div>
              <div style={{ fontSize: 13, color: "#64748B", marginTop: 2 }}>管理者パスワードを変更</div>
            </div>
            <span style={{ color: "#94A3B8" }}>→</span>
          </button>
        </div>

        {notSubmitted.length > 0 && (
          <div style={styles.card}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10, color: "#F59E0B" }}>
              ⚠ 未提出のスタッフ（{notSubmitted.length}名）
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {notSubmitted.map((s) => (
                <span key={s.id} style={styles.badge("#F59E0B")}>{getFullName(s)}</span>
              ))}
            </div>
          </div>
        )}

        {/* 提出期限設定 */}
        <div style={styles.card}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>⏰ シフト提出期限</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="date"
              style={{ ...styles.input, flex: "1 1 180px" }}
              value={deadlineInput}
              onChange={(e) => setDeadlineInput(e.target.value)}
            />
            <button
              style={styles.btnSm("#2563EB")}
              onClick={() => {
                if (deadlineInput) onSaveDeadline(year, month, deadlineInput);
              }}
            >
              設定
            </button>
            {currentDeadline && (
              <button
                style={styles.btnSm("#EF4444", true)}
                onClick={() => onRemoveDeadline(year, month)}
              >
                解除
              </button>
            )}
          </div>
          {currentDeadline && (
            <div style={{ fontSize: 13, color: "#475569", marginTop: 8 }}>
              現在の期限: <strong>{currentDeadline}</strong>
              {new Date(currentDeadline) < new Date(new Date().toDateString())
                ? <span style={{ color: "#EF4444", marginLeft: 8 }}>（期限切れ — スタッフは編集不可）</span>
                : <span style={{ color: "#10B981", marginLeft: 8 }}>（受付中）</span>
              }
            </div>
          )}
          {!currentDeadline && (
            <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 8 }}>
              ※ 期限を設定しない場合、スタッフはいつでもシフトを提出・変更できます
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── GROUP CALENDAR (simple horizontal table) ────────────
function GroupCalendar({ group, groups, staffList, shiftsData, year, month, onChangeMonth, onBack, parenOverrides, onToggleParen, eventOverrides, onToggleEvent, onSaveShift }) {
  const ownStaff = useMemo(() => staffList.filter((s) => s.group === group), [staffList, group]);
  const otherStaff = useMemo(() => staffList.filter((s) => s.group !== group), [staffList, group]);
  const allStaff = useMemo(() => [...ownStaff, ...otherStaff], [ownStaff, otherStaff]);
  const days = getDaysInMonth(year, month);

  const [editMode, setEditMode] = useState(false);
  const [editAction, setEditAction] = useState(null);

  const applyAction = (staffId, d) => {
    if (!editMode || !editAction) return;

    if (editAction === "paren") {
      onToggleParen(group, d, staffId);
      return;
    }
    if (editAction === "event") {
      onToggleEvent(group, d, staffId);
      return;
    }

    const key = `${staffId}_${year}-${month}`;
    const existing = shiftsData[key]?.shifts || {};
    const updated = { ...existing };

    if (editAction === "work") {
      updated[d] = "work";
    } else if (editAction === "clear") {
      delete updated[d];
    }
    onSaveShift(staffId, year, month, updated);
  };

  const actionButtons = [
    { key: "work", label: "○ 出勤", color: "#2563EB", bg: "#EFF6FF" },
    { key: "clear", label: "ー 削除", color: "#EF4444", bg: "#FEF2F2" },
    { key: "paren", label: "( ) 括弧切替", color: "#6366F1", bg: "#EEF2FF" },
    { key: "event", label: "🎪 イベント", color: "#F59E0B", bg: "#FFFBEB" },
  ];

  return (
    <>
      <Header title={groups.find((g) => g.id === group)?.name || group} onBack={onBack} />
      <div style={{ ...styles.container, maxWidth: 1200 }}>
        <MonthSelector year={year} month={month} onChange={onChangeMonth} />

        {/* Edit Mode Toggle */}
        <div style={{
          ...styles.card, padding: "12px 16px", marginBottom: 12,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          border: editMode ? "2px solid #2563EB" : "1px solid #E2E8F0",
          background: editMode ? "#F8FAFF" : "#FFFFFF",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>{editMode ? "✏️" : "👁"}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: editMode ? "#2563EB" : "#475569" }}>
              {editMode ? "編集モード ON" : "閲覧モード"}
            </span>
          </div>
          <button
            style={{
              ...styles.btnSm(editMode ? "#EF4444" : "#2563EB"),
              minWidth: 100,
            }}
            onClick={() => {
              setEditMode(!editMode);
              setEditAction(null);
            }}
          >
            {editMode ? "編集を終了" : "✏️ 編集する"}
          </button>
        </div>

        {/* Action Buttons (visible only in edit mode) */}
        {editMode && (
          <div style={{
            ...styles.card, padding: "12px 16px", marginBottom: 12,
            position: "sticky", top: 56, zIndex: 50,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          }}>
            <div style={{ fontSize: 12, color: "#64748B", marginBottom: 8 }}>
              操作を選んでから、表のセルをタップしてください
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {actionButtons.map((ab) => (
                <button
                  key={ab.key}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: editAction === ab.key ? `2.5px solid ${ab.color}` : "1.5px solid #E2E8F0",
                    background: editAction === ab.key ? ab.bg : "#FFFFFF",
                    color: ab.color,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 0.15s",
                    boxShadow: editAction === ab.key ? `0 0 0 3px ${ab.color}22` : "none",
                  }}
                  onClick={() => setEditAction(editAction === ab.key ? null : ab.key)}
                >
                  {ab.label}
                </button>
              ))}
            </div>
            {editAction && (
              <div style={{ fontSize: 12, color: "#2563EB", marginTop: 8, fontWeight: 500 }}>
                ▶ 「{actionButtons.find((a) => a.key === editAction)?.label}」を選択中 — セルをタップして適用
              </div>
            )}
          </div>
        )}

        {allStaff.length === 0 ? (
          <div style={{ ...styles.card, textAlign: "center", color: "#64748B" }}>
            スタッフが登録されていません
          </div>
        ) : (
          <div style={{ ...styles.card, padding: 0, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{
                    position: "sticky", left: 0, background: "#F1F5F9", padding: "10px 12px",
                    textAlign: "left", fontWeight: 600, borderBottom: "2px solid #E2E8F0",
                    minWidth: 80, zIndex: 2, fontSize: 13, color: "#475569",
                  }}>
                    名前
                  </th>
                  {Array.from({ length: days }, (_, i) => {
                    const d = i + 1;
                    const dow = getDayOfWeek(year, month, d);
                    const col = getDayColor(year, month, d);
                    const we = isWeekend(year, month, d);
                    return (
                      <th key={d} style={{
                        padding: "6px 0", textAlign: "center",
                        borderBottom: "2px solid #E2E8F0",
                        background: we ? "#F8FAFC" : "#F1F5F9",
                        minWidth: 36, fontWeight: 600,
                      }}>
                        <div style={{ color: col, fontSize: 13 }}>{d}</div>
                        <div style={{ color: col, fontSize: 10, opacity: 0.7 }}>{dow}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {allStaff.map((staff, idx) => {
                  const key = `${staff.id}_${year}-${month}`;
                  const shiftEntry = shiftsData[key];
                  const shifts = shiftEntry?.shifts || {};
                  const isOther = staff.group !== group;
                  const bgColor = idx % 2 === 0 ? "#FFFFFF" : "#FAFBFC";
                  return (
                    <tr key={staff.id} style={{ background: bgColor }}>
                      <td style={{
                        position: "sticky", left: 0, padding: "10px 12px",
                        fontWeight: 500, borderBottom: "1px solid #F1F5F9",
                        background: bgColor,
                        zIndex: 1, whiteSpace: "nowrap", fontSize: 13,
                      }}>
                        {getFullName(staff)}
                        {isOther && (
                          <span style={{ ...styles.badge("#6366F1"), marginLeft: 6, fontSize: 10 }}>他店舗</span>
                        )}
                        {!shiftEntry && (
                          <span style={{ ...styles.badge("#F59E0B"), marginLeft: 6, fontSize: 10 }}>未提出</span>
                        )}
                      </td>
                      {Array.from({ length: days }, (_, i) => {
                        const d = i + 1;
                        const val = shifts[d];
                        const st = val ? SHIFT_TYPES[val] : null;
                        const we = isWeekend(year, month, d);
                        const canClick = editMode && editAction;

                        let cellContent = st?.emoji || "ー";
                        let cellColor = st?.color || "#E2E8F0";
                        let cellBg = val ? st.bg : we ? "#FAFAFA" : "transparent";
                        let cellDecoration = "none";
                        let cellFontSize = 14;
                        let cellPadding = "8px 0";

                        if (val === "work") {
                          const overrideKey = `${group}_${d}_${staff.id}`;
                          const isEvent = !!eventOverrides[overrideKey];
                          const overridden = !!parenOverrides[overrideKey];
                          const hasParen = isOther ? !overridden : overridden;
                          const displayName = getLastName(staff);
                          cellContent = isEvent
                            ? `${displayName}(イベ)`
                            : hasParen ? `(${displayName})` : displayName;
                          cellColor = isEvent ? "#EF4444" : hasParen ? "#6366F1" : st.color;
                          cellBg = isEvent ? "#FEF2F2" : st.bg;
                          cellDecoration = isEvent ? "line-through" : "none";
                          cellFontSize = 12;
                          cellPadding = "4px 2px";
                        }

                        return (
                          <td key={d} style={{
                            textAlign: "center", padding: cellPadding,
                            borderBottom: "1px solid #F1F5F9",
                            background: cellBg,
                            fontWeight: val === "work" ? 600 : 700,
                            fontSize: cellFontSize,
                            color: cellColor,
                            textDecoration: cellDecoration,
                            cursor: canClick ? "pointer" : "default",
                            outline: canClick ? "1px dashed #CBD5E1" : "none",
                          }}
                          onClick={() => canClick && applyAction(staff.id, d)}
                          onMouseEnter={(e) => { if (canClick) e.currentTarget.style.background = "#E0E7FF"; }}
                          onMouseLeave={(e) => { if (canClick) e.currentTarget.style.background = cellBg; }}
                          >
                            {cellContent}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}


// ─── PDF CALENDAR PAGE ───────────────────────────────────
function PDFCalendarPage({ staffList, shiftsData, year, month, onChangeMonth, onBack, parenOverrides, onToggleParen, eventOverrides, onToggleEvent, groups, onSaveShift }) {
  const days = getDaysInMonth(year, month);
  const [editMode, setEditMode] = useState(false);
  const [editAction, setEditAction] = useState(null);

  const buildDayEntries = (viewGroup) => {
    const entries = {};
    for (let d = 1; d <= days; d++) {
      const primary = [];
      const secondary = [];

      staffList.forEach((staff) => {
        const shiftEntry = shiftsData[`${staff.id}_${year}-${month}`];
        if (!shiftEntry) return;
        if (shiftEntry.shifts[d] !== "work") return;

        // Skip if marked as event dispatch
        const eventKey = `${viewGroup}_${d}_${staff.id}`;
        if (eventOverrides[eventKey]) return;

        const displayName = getLastName(staff);
        const isOtherGroup = staff.group !== viewGroup;
        const overrideKey = `${viewGroup}_${d}_${staff.id}`;
        const overridden = !!parenOverrides[overrideKey];
        const useParen = isOtherGroup ? !overridden : overridden;

        if (useParen) {
          secondary.push({ name: `(${displayName})`, staffId: staff.id, day: d, viewGroup });
        } else {
          primary.push({ name: displayName, staffId: staff.id, day: d, viewGroup });
        }
      });

      entries[d] = { primary, secondary };
    }
    return entries;
  };

  const allGroupEntries = useMemo(() => {
    const result = {};
    groups.forEach((gr) => {
      result[gr.id] = buildDayEntries(gr.id);
    });
    return result;
  }, [staffList, shiftsData, year, month, parenOverrides, eventOverrides, groups]);

  const contactList = useMemo(() => {
    return staffList.filter((s) => s.phone && s.phone.trim() !== "");
  }, [staffList]);

  const monthStr = `${year}.${String(month).padStart(2, "0")}`;

  // Generate calendar page HTML for a group
  const renderCalendarHTML = (title, entries) => {
    const firstDay = new Date(year, month - 1, 1).getDay();
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

    const weekHeaders = ["日", "月", "火", "水", "木", "金", "土"]
      .map((d, i) => `<th class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${d}</th>`)
      .join("");

    const tbody = weeks.map(week =>
      "<tr>" + week.map((d, di) => {
        if (d === null) return '<td class="empty-day"></td>';
        const entry = entries[d];
        const dayClass = di === 0 ? "sun" : di === 6 ? "sat" : "";
        const names = entry ? [
          ...entry.primary.map(e => `<span class="pdf-name">${e.name}</span>`),
          ...entry.secondary.map(e => `<span class="pdf-name secondary">${e.name}</span>`)
        ].join("") : "";
        return `<td class="${dayClass}"><span class="pdf-daynum ${dayClass}">${d}</span>${names}</td>`;
      }).join("") + "</tr>"
    ).join("");

    const contactsHTML = contactList.length > 0 ? `
      <div class="pdf-contacts">
        <div class="pdf-contacts-title">【連絡先】</div>
        <div class="pdf-contacts-list">
          ${contactList.map(c => `
            <div class="pdf-contact-item">
              <span class="pdf-contact-name">${getLastName(c)}</span>
              <span class="pdf-contact-phone">${c.phone}</span>
            </div>
          `).join("")}
        </div>
      </div>
    ` : "";

    return `
      <div class="pdf-page">
        <div class="pdf-header">
          <div class="pdf-month">${monthStr}</div>
          <div class="pdf-title">${title}</div>
        </div>
        <table class="pdf-calendar">
          <thead><tr>${weekHeaders}</tr></thead>
          <tbody>${tbody}</tbody>
        </table>
        ${contactsHTML}
      </div>
    `;
  };

  const handlePrint = () => {
    const allPages = groups.map((gr) =>
      renderCalendarHTML(gr.name, allGroupEntries[gr.id] || {})
    ).join("\n");

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>${monthStr} シフト表</title>
  <style>
    @page { size: A4 portrait; margin: 8mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 20px;
      font-family: 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif;
      color: #000;
      background: #E5E7EB;
    }
    .toolbar {
      max-width: 210mm;
      margin: 0 auto 20px;
      display: flex;
      gap: 10px;
      justify-content: center;
      flex-wrap: wrap;
    }
    .toolbar button {
      padding: 12px 28px;
      font-size: 15px;
      font-weight: 600;
      border-radius: 8px;
      border: none;
      background: #2563EB;
      color: white;
      cursor: pointer;
      font-family: inherit;
    }
    .toolbar button.secondary {
      background: #64748B;
    }
    .toolbar .hint {
      width: 100%;
      text-align: center;
      color: #475569;
      font-size: 13px;
      margin-top: 6px;
    }
    .pdf-page {
      width: 210mm;
      height: 296mm;
      padding: 6mm 6mm 4mm;
      margin: 0 auto 20px;
      background: white;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      page-break-after: always;
      overflow: hidden;
    }
    .pdf-page:last-child { page-break-after: auto; }
    .pdf-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 3mm;
      padding: 0 2mm 1.5mm;
      border-bottom: 1px solid #000;
    }
    .pdf-month {
      font-size: 18pt;
      font-weight: 700;
      letter-spacing: 0.02em;
      border-bottom: 2px solid #000;
      padding-bottom: 1mm;
    }
    .pdf-title {
      font-size: 14pt;
      font-weight: 500;
    }
    .pdf-calendar {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      margin-bottom: 2mm;
    }
    .pdf-calendar th {
      border: 1px solid #333;
      padding: 1mm 0;
      font-size: 9pt;
      font-weight: 600;
      text-align: center;
      background: #F5F5F5;
    }
    .pdf-calendar th.sun { color: #C00000; }
    .pdf-calendar th.sat { color: #0070C0; }
    .pdf-calendar td {
      border: 1px solid #333;
      vertical-align: top;
      padding: 0.8mm 0.5mm 1mm;
      height: 22mm;
      font-size: 8pt;
      line-height: 1.25;
      overflow: hidden;
      text-align: center;
    }
    .pdf-calendar td.sun { background: #FDF4F4; }
    .pdf-calendar td.sat { background: #F4F8FD; }
    .pdf-calendar td.empty-day { background: #FAFAFA; }
    .pdf-daynum {
      font-weight: 700;
      font-size: 9pt;
      display: block;
      margin-bottom: 0.3mm;
      text-align: center;
    }
    .pdf-daynum.sun { color: #C00000; }
    .pdf-daynum.sat { color: #0070C0; }
    .pdf-name {
      display: block;
      font-size: 8pt;
      font-weight: 500;
      line-height: 1.25;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: center;
    }
    .pdf-name.secondary {
      color: #555;
      font-weight: 400;
    }
    .pdf-contacts {
      margin-top: 2mm;
      padding: 2mm 4mm;
      border: 1px solid #333;
      background: #FAFAFA;
    }
    .pdf-contacts-title {
      font-size: 10pt;
      font-weight: 700;
      margin-bottom: 1.5mm;
      letter-spacing: 0.05em;
    }
    .pdf-contacts-list {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 1mm 4mm;
      font-size: 9pt;
    }
    .pdf-contact-item {
      display: flex;
      align-items: baseline;
      gap: 2mm;
    }
    .pdf-contact-item::before {
      content: "・";
      margin-right: 0.5mm;
    }
    .pdf-contact-name {
      min-width: 10mm;
      font-weight: 600;
    }
    .pdf-contact-phone {
      font-weight: 400;
      letter-spacing: 0.02em;
    }
    @media print {
      body { background: white; padding: 0; }
      .toolbar { display: none !important; }
      .pdf-page { box-shadow: none; margin: 0; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button onclick="window.print()">🖨 印刷 / PDF保存</button>
    <button class="secondary" onclick="window.close()">閉じる</button>
    <div class="hint">「印刷 / PDF保存」を押して、送信先で「PDFに保存」を選ぶとPDFが作成できます。</div>
  </div>
  ${allPages}
</body>
</html>`;

    // Download HTML file (works inside sandboxed iframes)
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `シフト表_${monthStr}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <Header
        title="PDFカレンダー表示"
        onBack={onBack}
        rightAction={
          <button style={styles.btn("#2563EB")} onClick={handlePrint}>
            📥 PDF用ファイルをダウンロード
          </button>
        }
      />
      <div className="no-print" style={styles.container}>
        <MonthSelector year={year} month={month} onChange={onChangeMonth} />
        <div style={{ ...styles.card, background: "#FFFBEB", borderColor: "#FDE68A" }}>
          <div style={{ fontSize: 13, color: "#92400E", lineHeight: 1.7 }}>
            <strong>📥 PDFの作り方：</strong><br />
            ① 右上の「📥 PDF用ファイルをダウンロード」ボタンをクリック<br />
            ② <strong>HTMLファイル</strong>がダウンロードされます<br />
            ③ ダウンロードしたファイルを<strong>ダブルクリックで開く</strong>（ブラウザで開きます）<br />
            ④ 開いた画面で「印刷 / PDF保存」ボタン → 送信先で「<strong>PDFに保存</strong>」を選択
          </div>
        </div>

        {/* Edit Mode Toggle */}
        <div style={{
          ...styles.card, padding: "12px 16px", marginBottom: 12,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          border: editMode ? "2px solid #2563EB" : "1px solid #E2E8F0",
          background: editMode ? "#F8FAFF" : "#FFFFFF",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>{editMode ? "✏️" : "👁"}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: editMode ? "#2563EB" : "#475569" }}>
              {editMode ? "編集モード ON" : "閲覧モード"}
            </span>
          </div>
          <button
            style={{ ...styles.btnSm(editMode ? "#EF4444" : "#2563EB"), minWidth: 100 }}
            onClick={() => { setEditMode(!editMode); setEditAction(null); }}
          >
            {editMode ? "編集を終了" : "✏️ 編集する"}
          </button>
        </div>

        {editMode && (
          <div style={{
            ...styles.card, padding: "12px 16px", marginBottom: 12,
            position: "sticky", top: 56, zIndex: 50,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          }}>
            <div style={{ fontSize: 12, color: "#64748B", marginBottom: 8 }}>
              操作を選んでから、カレンダーの名前をタップしてください
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[
                { key: "paren", label: "( ) 括弧切替", color: "#6366F1", bg: "#EEF2FF" },
                { key: "event", label: "🎪 イベント", color: "#F59E0B", bg: "#FFFBEB" },
              ].map((ab) => (
                <button
                  key={ab.key}
                  style={{
                    padding: "8px 14px", borderRadius: 8,
                    border: editAction === ab.key ? `2.5px solid ${ab.color}` : "1.5px solid #E2E8F0",
                    background: editAction === ab.key ? ab.bg : "#FFFFFF",
                    color: ab.color, fontSize: 13, fontWeight: 600,
                    cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
                    boxShadow: editAction === ab.key ? `0 0 0 3px ${ab.color}22` : "none",
                  }}
                  onClick={() => setEditAction(editAction === ab.key ? null : ab.key)}
                >
                  {ab.label}
                </button>
              ))}
            </div>
            {editAction && (
              <div style={{ fontSize: 12, color: "#2563EB", marginTop: 8, fontWeight: 500 }}>
                ▶ 「{editAction === "paren" ? "( ) 括弧切替" : "🎪 イベント"}」を選択中 — 名前をタップして適用
              </div>
            )}
          </div>
        )}

        <div style={{ fontSize: 13, color: "#64748B", textAlign: "center", margin: "16px 0 8px" }}>
          ↓ 以下がPDFに出力される内容（画面プレビュー）です ↓
        </div>
      </div>

      <div id="print-area">
        <style>{`
          .pdf-page {
            width: 194mm;
            padding: 4mm 2mm;
            margin: 0 auto 20px;
            background: white;
            box-sizing: border-box;
            font-family: 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif;
            color: #000;
          }
          .pdf-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 3mm;
            padding: 0 2mm 1.5mm;
            border-bottom: 1px solid #000;
          }
          .pdf-month {
            font-size: 18pt;
            font-weight: 700;
            letter-spacing: 0.02em;
            border-bottom: 2px solid #000;
            padding-bottom: 1mm;
          }
          .pdf-title {
            font-size: 14pt;
            font-weight: 500;
          }
          .pdf-calendar {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            margin-bottom: 2mm;
          }
          .pdf-calendar th {
            border: 1px solid #333;
            padding: 1mm 0;
            font-size: 9pt;
            font-weight: 600;
            text-align: center;
            background: #F5F5F5;
          }
          .pdf-calendar th.sun { color: #C00000; }
          .pdf-calendar th.sat { color: #0070C0; }
          .pdf-calendar td {
            border: 1px solid #333;
            vertical-align: top;
            padding: 0.8mm 0.5mm 1mm;
            height: 22mm;
            font-size: 8pt;
            line-height: 1.25;
            overflow: hidden;
            text-align: center;
          }
          .pdf-calendar td.sun { background: #FDF4F4; }
          .pdf-calendar td.sat { background: #F4F8FD; }
          .pdf-calendar td.empty-day { background: #FAFAFA; border: 1px solid #DDD; }
          .pdf-daynum {
            font-weight: 700;
            font-size: 9pt;
            display: block;
            margin-bottom: 0.3mm;
            text-align: center;
          }
          .pdf-daynum.sun { color: #C00000; }
          .pdf-daynum.sat { color: #0070C0; }
          .pdf-name {
            display: block;
            font-size: 8pt;
            font-weight: 500;
            line-height: 1.25;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            text-align: center;
          }
          .pdf-name.secondary {
            color: #555;
            font-weight: 400;
          }
          .pdf-contacts {
            margin-top: 2mm;
            padding: 2mm 4mm;
            border: 1px solid #333;
            background: #FAFAFA;
          }
          .pdf-contacts-title {
            font-size: 10pt;
            font-weight: 700;
            margin-bottom: 1.5mm;
            letter-spacing: 0.05em;
          }
          .pdf-contacts-list {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 1mm 4mm;
            font-size: 9pt;
          }
          .pdf-contact-item {
            display: flex;
            align-items: baseline;
            gap: 2mm;
          }
          .pdf-contact-item::before {
            content: "・";
            margin-right: 0.5mm;
          }
          .pdf-contact-name {
            min-width: 10mm;
            font-weight: 600;
          }
        `}</style>

        {groups.map((gr, gi) => (
          <div key={gr.id} className={`pdf-page${gi > 0 ? " page-break" : ""}`}>
            <CalendarPage
              monthStr={monthStr}
              title={gr.name}
              year={year}
              month={month}
              days={days}
              entries={allGroupEntries[gr.id] || {}}
              contacts={contactList}
              onToggleParen={onToggleParen}
              eventOverrides={eventOverrides}
              onToggleEvent={onToggleEvent}
              viewGroup={gr.id}
              staffList={staffList}
              shiftsData={shiftsData}
              editMode={editMode}
              editAction={editAction}
            />
          </div>
        ))}
      </div>
    </>
  );
}

function CalendarPage({ monthStr, title, year, month, days, entries, contacts, onToggleParen, eventOverrides, onToggleEvent, viewGroup, staffList, shiftsData, editMode, editAction }) {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  // Build event staff list per day (those hidden from PDF)
  const eventStaffByDay = useMemo(() => {
    const result = {};
    if (!eventOverrides || !staffList) return result;
    for (let d = 1; d <= days; d++) {
      const evStaff = [];
      staffList.forEach((staff) => {
        const shiftEntry = shiftsData?.[`${staff.id}_${year}-${month}`];
        if (!shiftEntry) return;
        if (shiftEntry.shifts[d] !== "work") return;
        const eventKey = `${viewGroup}_${d}_${staff.id}`;
        if (eventOverrides[eventKey]) {
          evStaff.push({ name: getLastName(staff), staffId: staff.id });
        }
      });
      if (evStaff.length > 0) result[d] = evStaff;
    }
    return result;
  }, [eventOverrides, staffList, shiftsData, viewGroup, year, month, days]);

  const canClick = editMode && editAction;

  const handleNameClick = (vg, day, staffId) => {
    if (!canClick) return;
    if (editAction === "paren") onToggleParen(vg, day, staffId);
    else if (editAction === "event") onToggleEvent(vg, day, staffId);
  };

  const nameStyle = {
    cursor: canClick ? "pointer" : "default",
    borderRadius: 3,
    padding: "0 2px",
    transition: "background 0.15s",
    outline: canClick ? "1px dashed #CBD5E1" : "none",
  };

  return (
    <>
      <div className="pdf-header">
        <div className="pdf-month">{monthStr}</div>
        <div className="pdf-title">{title}</div>
      </div>

      <table className="pdf-calendar">
        <thead>
          <tr>
            {["日", "月", "火", "水", "木", "金", "土"].map((d, i) => (
              <th key={d} className={i === 0 ? "sun" : i === 6 ? "sat" : ""}>
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((d, di) => {
                if (d === null) {
                  return <td key={di} className="empty-day"></td>;
                }
                const entry = entries[d];
                const hasAny = entry && (entry.primary.length > 0 || entry.secondary.length > 0);
                const dayClass = di === 0 ? "sun" : di === 6 ? "sat" : "";

                return (
                  <td key={di} className={dayClass}>
                    <span className={`pdf-daynum ${dayClass}`}>{d}</span>
                    {hasAny && (
                      <>
                        {entry.primary.map((e, i) => (
                          <span
                            key={`p${i}`}
                            className="pdf-name"
                            style={nameStyle}
                            onClick={() => handleNameClick(e.viewGroup, e.day, e.staffId)}
                            onMouseEnter={(ev) => { if (canClick) ev.currentTarget.style.background = "#E0E7FF"; }}
                            onMouseLeave={(ev) => { if (canClick) ev.currentTarget.style.background = "transparent"; }}
                          >{e.name}</span>
                        ))}
                        {entry.secondary.map((e, i) => (
                          <span
                            key={`s${i}`}
                            className="pdf-name secondary"
                            style={nameStyle}
                            onClick={() => handleNameClick(e.viewGroup, e.day, e.staffId)}
                            onMouseEnter={(ev) => { if (canClick) ev.currentTarget.style.background = "#E0E7FF"; }}
                            onMouseLeave={(ev) => { if (canClick) ev.currentTarget.style.background = "transparent"; }}
                          >{e.name}</span>
                        ))}
                      </>
                    )}
                    {/* Show event-dispatched staff (strikethrough, only in edit mode) */}
                    {editMode && eventStaffByDay[d] && eventStaffByDay[d].map((ev, i) => (
                      <span
                        key={`ev${i}`}
                        className="pdf-name"
                        style={{
                          textDecoration: "line-through",
                          color: "#EF4444",
                          opacity: 0.7,
                          cursor: canClick ? "pointer" : "default",
                          borderRadius: 3,
                          padding: "0 2px",
                          fontSize: "8.5pt",
                          outline: canClick ? "1px dashed #FECACA" : "none",
                        }}
                        onClick={() => { if (canClick && editAction === "event") onToggleEvent(viewGroup, d, ev.staffId); }}
                        onMouseEnter={(e) => { if (canClick) e.currentTarget.style.background = "#FEE2E2"; }}
                        onMouseLeave={(e) => { if (canClick) e.currentTarget.style.background = "transparent"; }}
                      >{ev.name}(イベント)</span>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {contacts.length > 0 && (
        <div className="pdf-contacts">
          <div className="pdf-contacts-title">【連絡先】</div>
          <div className="pdf-contacts-list">
            {contacts.map((c) => (
              <div key={c.id} className="pdf-contact-item">
                <span className="pdf-contact-name">{getLastName(c)}</span>
                <span>{c.phone}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ─── CHANGE PASSWORD ─────────────────────────────────────
function ChangePasswordPage({ adminPass, onSave, onBack }) {
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    setError("");
    if (currentPass !== adminPass) {
      setError("現在のパスワードが違います");
      return;
    }
    if (newPass.length < 4) {
      setError("新しいパスワードは4文字以上にしてください");
      return;
    }
    if (newPass !== confirmPass) {
      setError("新しいパスワードが一致しません");
      return;
    }
    await onSave(newPass);
    setSuccess(true);
  };

  if (success) {
    return (
      <>
        <Header title="パスワード変更" onBack={onBack} />
        <div style={styles.container}>
          <div style={{ ...styles.card, textAlign: "center", padding: "48px 24px" }} className="scale-in">
            <div style={{ fontSize: 48, marginBottom: 16 }} className="pop-in">✅</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px", color: "#1E293B" }}>
              パスワードを変更しました
            </h2>
            <p style={{ color: "#64748B", fontSize: 14, margin: "0 0 32px" }}>
              次回から新しいパスワードでログインしてください
            </p>
            <button style={styles.btn("#2563EB")} onClick={onBack}>
              管理者メニューに戻る
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="パスワード変更" onBack={onBack} />
      <div style={styles.container}>
        <div style={{ ...styles.card, maxWidth: 400, margin: "24px auto" }} className="fade-in">
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>🔑</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>管理者パスワード変更</h2>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
                現在のパスワード
              </label>
              <input
                type="password"
                style={styles.input}
                value={currentPass}
                onChange={(e) => { setCurrentPass(e.target.value); setError(""); }}
                placeholder="現在のパスワード"
              />
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
                新しいパスワード
              </label>
              <input
                type="password"
                style={styles.input}
                value={newPass}
                onChange={(e) => { setNewPass(e.target.value); setError(""); }}
                placeholder="4文字以上"
              />
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
                新しいパスワード（確認）
              </label>
              <input
                type="password"
                style={styles.input}
                value={confirmPass}
                onChange={(e) => { setConfirmPass(e.target.value); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                placeholder="もう一度入力"
              />
            </div>

            {error && (
              <div style={{ color: "#EF4444", fontSize: 13, textAlign: "center", padding: "8px 0" }}>
                {error}
              </div>
            )}

            <button style={{ ...styles.btn("#2563EB"), width: "100%", marginTop: 4 }} onClick={handleSubmit}>
              パスワードを変更する
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── STAFF MANAGEMENT ────────────────────────────────────
function StaffManagePage({ staffList, groups, onSave, onBack }) {
  const [list, setList] = useState(staffList);
  const [newLastName, setNewLastName] = useState("");
  const [newFirstName, setNewFirstName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newGroup, setNewGroup] = useState(groups[0]?.id || "");
  const [editId, setEditId] = useState(null);
  const [editLastName, setEditLastName] = useState("");
  const [editFirstName, setEditFirstName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editGroup, setEditGroup] = useState(groups[0]?.id || "");

  const addStaff = () => {
    if (!newLastName.trim()) return;
    const lastName = newLastName.trim();
    const firstName = newFirstName.trim();
    const updated = [...list, {
      id: genId(),
      lastName,
      firstName,
      name: `${lastName} ${firstName}`.trim(), // legacy compatibility
      phone: newPhone.trim(),
      group: newGroup,
    }];
    setList(updated);
    onSave(updated);
    setNewLastName("");
    setNewFirstName("");
    setNewPhone("");
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const deleteStaff = (id) => {
    if (confirmDeleteId === id) {
      const updated = list.filter((s) => s.id !== id);
      setList(updated);
      onSave(updated);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(id);
    }
  };

  const startEdit = (staff) => {
    setEditId(staff.id);
    // Backward compat: if lastName not set, try to split old name field
    if (staff.lastName !== undefined) {
      setEditLastName(staff.lastName || "");
      setEditFirstName(staff.firstName || "");
    } else {
      const parts = (staff.name || "").split(/[\s　]/);
      setEditLastName(parts[0] || "");
      setEditFirstName(parts.slice(1).join(" ") || "");
    }
    setEditPhone(staff.phone || "");
    setEditGroup(staff.group);
  };

  const saveEdit = () => {
    const lastName = editLastName.trim();
    const firstName = editFirstName.trim();
    const updated = list.map((s) => s.id === editId ? {
      ...s,
      lastName,
      firstName,
      name: `${lastName} ${firstName}`.trim(),
      phone: editPhone.trim(),
      group: editGroup,
    } : s);
    setList(updated);
    onSave(updated);
    setEditId(null);
  };

  return (
    <>
      <Header title="スタッフ管理" onBack={onBack} />
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>➕ スタッフを追加</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                style={{ ...styles.input, flex: 1 }}
                placeholder="苗字（必須）例: 山田"
                value={newLastName}
                onChange={(e) => setNewLastName(e.target.value)}
              />
              <input
                style={{ ...styles.input, flex: 1 }}
                placeholder="名前（任意）例: 太郎"
                value={newFirstName}
                onChange={(e) => setNewFirstName(e.target.value)}
              />
            </div>
            <input
              style={styles.input}
              placeholder="電話番号（例: 080-1234-5678）※PDFの連絡先に表示"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <select
                style={{ ...styles.select, flex: 1 }}
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
              >
                {groups.map((gr) => (
                  <option key={gr.id} value={gr.id}>{gr.name}</option>
                ))}
              </select>
              <button style={styles.btn("#2563EB")} onClick={addStaff}>追加</button>
            </div>
            <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
              ※ PDFカレンダーには<strong>苗字のみ</strong>が表示されます
            </div>
          </div>
        </div>

        {groups.map((gr) => {
          const members = list.filter((s) => s.group === gr.id);
          return (
            <div key={gr.id} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#64748B", marginBottom: 8, paddingLeft: 4 }}>
                {gr.name}（{members.length}名）
              </div>
              {members.length === 0 ? (
                <div style={{ ...styles.card, textAlign: "center", color: "#94A3B8", fontSize: 13 }}>
                  スタッフなし
                </div>
              ) : (
                members.map((staff) => (
                  <div key={staff.id} style={{ ...styles.card, marginBottom: 6, padding: "12px 16px" }}>
                    {editId === staff.id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", gap: 8 }}>
                          <input
                            style={{ ...styles.input, flex: 1 }}
                            value={editLastName}
                            onChange={(e) => setEditLastName(e.target.value)}
                            placeholder="苗字"
                          />
                          <input
                            style={{ ...styles.input, flex: 1 }}
                            value={editFirstName}
                            onChange={(e) => setEditFirstName(e.target.value)}
                            placeholder="名前（任意）"
                          />
                        </div>
                        <input
                          style={styles.input}
                          value={editPhone}
                          onChange={(e) => setEditPhone(e.target.value)}
                          placeholder="電話番号"
                        />
                        <div style={{ display: "flex", gap: 8 }}>
                          <select
                            style={{ ...styles.select, flex: 1 }}
                            value={editGroup}
                            onChange={(e) => setEditGroup(e.target.value)}
                          >
                            {groups.map((gr) => (
                              <option key={gr.id} value={gr.id}>{gr.name}</option>
                            ))}
                          </select>
                          <button style={styles.btnSm("#10B981")} onClick={saveEdit}>保存</button>
                          <button style={styles.btnSm("#64748B", true)} onClick={() => setEditId(null)}>取消</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 600 }}>
                            {getLastName(staff)}
                            {staff.firstName && (
                              <span style={{ color: "#64748B", fontWeight: 400, marginLeft: 6 }}>
                                {staff.firstName}
                              </span>
                            )}
                          </div>
                          {staff.phone && (
                            <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>📞 {staff.phone}</div>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                          <button style={styles.btnSm("#2563EB", true)} onClick={() => { startEdit(staff); setConfirmDeleteId(null); }}>編集</button>
                          {confirmDeleteId === staff.id ? (
                            <>
                              <span style={{ fontSize: 12, color: "#EF4444", fontWeight: 500 }}>削除する？</span>
                              <button style={styles.btnSm("#EF4444")} onClick={() => deleteStaff(staff.id)}>はい</button>
                              <button style={styles.btnSm("#64748B", true)} onClick={() => setConfirmDeleteId(null)}>いいえ</button>
                            </>
                          ) : (
                            <button style={styles.btnSm("#EF4444", true)} onClick={() => deleteStaff(staff.id)}>削除</button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── GROUP MANAGEMENT ────────────────────────────────────
function GroupManagePage({ groups, onSave, onBack }) {
  const [list, setList] = useState(groups);
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");

  const addGroup = () => {
    if (!newName.trim()) return;
    const id = genId();
    const maxOrder = list.reduce((max, g) => Math.max(max, g.sort_order || 0), 0);
    const updated = [...list, { id, name: newName.trim(), sort_order: maxOrder + 1 }];
    setList(updated);
    onSave(updated);
    setNewName("");
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const deleteGroup = (id) => {
    if (confirmDeleteId === id) {
      const updated = list.filter((g) => g.id !== id);
      setList(updated);
      onSave(updated);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(id);
    }
  };

  const startEdit = (group) => {
    setEditId(group.id);
    setEditName(group.name);
  };

  const saveEdit = () => {
    const updated = list.map((g) => g.id === editId ? { ...g, name: editName.trim() } : g);
    setList(updated);
    onSave(updated);
    setEditId(null);
  };

  const moveUp = (idx) => {
    if (idx === 0) return;
    const updated = [...list];
    [updated[idx - 1], updated[idx]] = [updated[idx], updated[idx - 1]];
    updated.forEach((g, i) => { g.sort_order = i + 1; });
    setList(updated);
    onSave(updated);
  };

  const moveDown = (idx) => {
    if (idx >= list.length - 1) return;
    const updated = [...list];
    [updated[idx], updated[idx + 1]] = [updated[idx + 1], updated[idx]];
    updated.forEach((g, i) => { g.sort_order = i + 1; });
    setList(updated);
    onSave(updated);
  };

  return (
    <>
      <Header title="店舗グループ管理" onBack={onBack} />
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>➕ 店舗グループを追加</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...styles.input, flex: 1 }}
              placeholder="店舗グループ名（例: 岐阜南店舗）"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addGroup()}
            />
            <button style={styles.btn("#2563EB")} onClick={addGroup}>追加</button>
          </div>
        </div>

        <div style={{ fontSize: 14, fontWeight: 600, color: "#64748B", marginBottom: 8, paddingLeft: 4 }}>
          登録済み店舗（{list.length}件）
        </div>

        {list.length === 0 ? (
          <div style={{ ...styles.card, textAlign: "center", color: "#94A3B8", fontSize: 13 }}>
            店舗グループが登録されていません
          </div>
        ) : (
          list.map((group, idx) => (
            <div key={group.id} style={{ ...styles.card, marginBottom: 6, padding: "12px 16px" }}>
              {editId === group.id ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    style={{ ...styles.input, flex: 1 }}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                  />
                  <button style={styles.btnSm("#10B981")} onClick={saveEdit}>保存</button>
                  <button style={styles.btnSm("#64748B", true)} onClick={() => setEditId(null)}>取消</button>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <button
                        style={{ border: "none", background: "transparent", cursor: idx === 0 ? "default" : "pointer", color: idx === 0 ? "#E2E8F0" : "#64748B", fontSize: 12, padding: 0, fontFamily: "inherit" }}
                        onClick={() => moveUp(idx)}
                        disabled={idx === 0}
                      >▲</button>
                      <button
                        style={{ border: "none", background: "transparent", cursor: idx >= list.length - 1 ? "default" : "pointer", color: idx >= list.length - 1 ? "#E2E8F0" : "#64748B", fontSize: 12, padding: 0, fontFamily: "inherit" }}
                        onClick={() => moveDown(idx)}
                        disabled={idx >= list.length - 1}
                      >▼</button>
                    </div>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{group.name}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                    <button style={styles.btnSm("#2563EB", true)} onClick={() => { startEdit(group); setConfirmDeleteId(null); }}>編集</button>
                    {confirmDeleteId === group.id ? (
                      <>
                        <span style={{ fontSize: 12, color: "#EF4444", fontWeight: 500 }}>削除する？</span>
                        <button style={styles.btnSm("#EF4444")} onClick={() => deleteGroup(group.id)}>はい</button>
                        <button style={styles.btnSm("#64748B", true)} onClick={() => setConfirmDeleteId(null)}>いいえ</button>
                      </>
                    ) : (
                      <button style={styles.btnSm("#EF4444", true)} onClick={() => deleteGroup(group.id)}>削除</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}

        <div style={{ ...styles.card, background: "#FFFBEB", borderColor: "#FDE68A", marginTop: 12 }}>
          <div style={{ fontSize: 12, color: "#92400E", lineHeight: 1.6 }}>
            💡 ▲▼ボタンで表示順を変更できます。この順番がPDFカレンダーのページ順になります。
          </div>
        </div>
      </div>
    </>
  );
}

// ─── MAIN APP ────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("top");
  const [staffList, setStaffList] = useState([]);
  const [shiftsData, setShiftsData] = useState({});
  const [adminPass, setAdminPass] = useState(DEFAULT_ADMIN_PASS);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [loading, setLoading] = useState(true);
  const [parenOverrides, setParenOverrides] = useState({});
  const [eventOverrides, setEventOverrides] = useState({});
  const [deadlines, setDeadlines] = useState({});
  const [groups, setGroups] = useState([]);

  useEffect(() => {
    const styleEl = document.createElement("style");
    styleEl.textContent = PRINT_CSS;
    document.head.appendChild(styleEl);
    return () => { document.head.removeChild(styleEl); };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [staffRows, shiftRows, adminRows, parenRows, eventRows, deadlineRows, groupRows] = await Promise.all([
          api.get("staff", "order=created_at"),
          api.get("shifts"),
          api.get("admin_settings"),
          api.get("paren_overrides"),
          api.get("event_overrides"),
          api.get("shift_deadlines"),
          api.get("groups", "order=sort_order"),
        ]);
        setStaffList(staffRows.map(dbToStaff));
        setShiftsData(dbShiftsToMap(shiftRows));
        const passRow = adminRows.find((r) => r.key === "password");
        setAdminPass(passRow?.value || DEFAULT_ADMIN_PASS);
        setParenOverrides(dbParenToMap(parenRows));
        setEventOverrides(dbEventToMap(eventRows, groupRows.map((r) => r.id)));
        const dlMap = {};
        deadlineRows.forEach((r) => { dlMap[`${r.year}-${r.month}`] = r.deadline_date; });
        setDeadlines(dlMap);
        setGroups(groupRows.map((r) => ({ id: r.id, name: r.name, sort_order: r.sort_order })));
      } catch (e) {
        console.error("Load error:", e);
      }
      setLoading(false);
    })();
  }, []);

  const saveStaff = useCallback(async (list) => {
    setStaffList(list);
    try {
      // Upsert all current staff
      if (list.length > 0) {
        await api.upsert("staff", list.map((s) => ({
          id: s.id, last_name: s.lastName || s.name, first_name: s.firstName || "", phone: s.phone || "", group: s.group,
        })));
      }
      // Delete staff not in the new list
      const currentIds = list.map((s) => s.id);
      const dbStaff = await api.get("staff");
      const toDelete = dbStaff.filter((r) => !currentIds.includes(r.id));
      for (const s of toDelete) {
        await api.del("staff", `id=eq.${s.id}`);
      }
    } catch (e) { console.error("Save staff error:", e); }
  }, []);

  const saveAdminPass = useCallback(async (newPass) => {
    setAdminPass(newPass);
    try {
      await api.patch("admin_settings", "key=eq.password", { value: newPass });
    } catch (e) { console.error("Save pass error:", e); }
  }, []);

  const saveGroups = useCallback(async (list) => {
    setGroups(list);
    try {
      if (list.length > 0) {
        await api.upsert("groups", list.map((g) => ({
          id: g.id, name: g.name, sort_order: g.sort_order || 0,
        })));
      }
      const dbGroups = await api.get("groups");
      const currentIds = list.map((g) => g.id);
      const toDelete = dbGroups.filter((r) => !currentIds.includes(r.id));
      for (const g of toDelete) {
        await api.del("groups", `id=eq.${g.id}`);
      }
    } catch (e) { console.error("Save groups error:", e); }
  }, []);

  const saveDeadline = useCallback(async (y, m, dateStr) => {
    const key = `${y}-${m}`;
    const updated = { ...deadlines, [key]: dateStr };
    setDeadlines(updated);
    try {
      await api.upsert("shift_deadlines", { year: y, month: m, deadline_date: dateStr });
    } catch (e) { console.error("Save deadline error:", e); }
  }, [deadlines]);

  const removeDeadline = useCallback(async (y, m) => {
    const key = `${y}-${m}`;
    const updated = { ...deadlines };
    delete updated[key];
    setDeadlines(updated);
    try {
      await api.del("shift_deadlines", `year=eq.${y}&month=eq.${m}`);
    } catch (e) { console.error("Remove deadline error:", e); }
  }, [deadlines]);

  const isDeadlinePassed = useCallback((y, m) => {
    const key = `${y}-${m}`;
    const dl = deadlines[key];
    if (!dl) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(dl) < today;
  }, [deadlines]);

  const deleteShift = useCallback(async (staffId, y, m) => {
    const key = `${staffId}_${y}-${m}`;
    const updated = { ...shiftsData };
    delete updated[key];
    setShiftsData(updated);
    try {
      await api.del("shifts", `staff_id=eq.${staffId}&year=eq.${y}&month=eq.${m}`);
    } catch (e) { console.error("Delete shift error:", e); }
  }, [shiftsData]);

  const saveShift = useCallback(async (staffId, y, m, shifts) => {
    const key = `${staffId}_${y}-${m}`;
    const updated = {
      ...shiftsData,
      [key]: { staffId, year: y, month: m, shifts, submittedAt: new Date().toISOString() },
    };
    setShiftsData(updated);
    try {
      await api.upsert("shifts", { staff_id: staffId, year: y, month: m, shifts, submitted_at: new Date().toISOString() });
    } catch (e) { console.error("Save shift error:", e); }
  }, [shiftsData]);

  const changeMonth = useCallback((y, m) => {
    setYear(y);
    setMonth(m);
  }, []);

  const toggleParen = useCallback(async (viewGroup, day, staffId) => {
    const key = `${viewGroup}_${day}_${staffId}`;
    const updated = { ...parenOverrides };
    if (updated[key]) {
      delete updated[key];
      try { await api.del("paren_overrides", `view_group=eq.${viewGroup}&day=eq.${day}&staff_id=eq.${staffId}`); } catch (e) { console.error(e); }
    } else {
      updated[key] = true;
      try { await api.post("paren_overrides", { view_group: viewGroup, day, staff_id: staffId }); } catch (e) { console.error(e); }
    }
    setParenOverrides(updated);
  }, [parenOverrides]);

  const toggleEvent = useCallback(async (viewGroup, day, staffId) => {
    const updated = { ...eventOverrides };
    const currentKey = `${viewGroup}_${day}_${staffId}`;
    if (updated[currentKey]) {
      // Remove for all groups
      groups.forEach((gr) => { delete updated[`${gr.id}_${day}_${staffId}`]; });
      try { await api.del("event_overrides", `day=eq.${day}&staff_id=eq.${staffId}&year=eq.${year}&month=eq.${month}`); } catch (e) { console.error(e); }
    } else {
      // Add for all groups
      groups.forEach((gr) => { updated[`${gr.id}_${day}_${staffId}`] = true; });
      try { await api.upsert("event_overrides", { day, staff_id: staffId, year, month }); } catch (e) { console.error(e); }
    }
    setEventOverrides(updated);
  }, [eventOverrides, year, month, groups]);

  if (loading) {
    return (
      <div style={{ ...styles.app, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: "#64748B" }} className="fade-in">
          <div style={{ fontSize: 32, marginBottom: 12 }} className="pop-in">📅</div>
          <div>読み込み中...</div>
        </div>
      </div>
    );
  }

  const getExistingShifts = () => {
    if (!selectedStaff) return null;
    const entry = shiftsData[`${selectedStaff.id}_${year}-${month}`];
    return entry?.shifts || null;
  };

  return (
    <div style={styles.app}>
      {page === "top" && <TopPage onNavigate={(p) => setPage(p)} />}

      {page === "staffSelect" && (
        <StaffSelectPage
          staffList={staffList}
          groups={groups}
          onSelect={(staff) => {
            setSelectedStaff(staff);
            setYear(currentYear);
            setMonth(currentMonth);
            setPage("shiftInput");
          }}
          onBack={() => setPage("top")}
        />
      )}

      {page === "shiftInput" && selectedStaff && (
        <ShiftInputPage
          staff={selectedStaff}
          year={year}
          month={month}
          existingShifts={getExistingShifts()}
          onChangeMonth={(y, m) => changeMonth(y, m)}
          onSubmit={async (shifts) => {
            await saveShift(selectedStaff.id, year, month, shifts);
            setPage("complete");
          }}
          onBack={() => setPage("staffSelect")}
          deadline={deadlines[`${year}-${month}`] || null}
          isLocked={isDeadlinePassed(year, month)}
        />
      )}

      {page === "complete" && (
        <CompletePage staff={selectedStaff} onBack={() => setPage("top")} />
      )}

      {page === "adminLogin" && (
        <AdminLoginPage
          adminPass={adminPass}
          onLogin={() => {
            setYear(currentYear);
            setMonth(currentMonth);
            setPage("adminDash");
          }}
          onBack={() => setPage("top")}
        />
      )}

      {page === "adminDash" && (
        <AdminDashboard
          staffList={staffList}
          shiftsData={shiftsData}
          year={year}
          month={month}
          onChangeMonth={changeMonth}
          onNavigate={(p, group) => {
            if (p === "calendar") {
              setSelectedGroup(group);
              setPage("calendar");
            } else {
              setPage(p);
            }
          }}
          onLogout={() => setPage("top")}
          deadlines={deadlines}
          onSaveDeadline={saveDeadline}
          onRemoveDeadline={removeDeadline}
          groups={groups}
        />
      )}

      {page === "calendar" && selectedGroup && (
        <GroupCalendar
          group={selectedGroup}
          groups={groups}
          staffList={staffList}
          shiftsData={shiftsData}
          year={year}
          month={month}
          onChangeMonth={changeMonth}
          onBack={() => setPage("adminDash")}
          parenOverrides={parenOverrides}
          onToggleParen={toggleParen}
          eventOverrides={eventOverrides}
          onToggleEvent={toggleEvent}
          onSaveShift={saveShift}
        />
      )}

      {page === "pdfView" && (
        <PDFCalendarPage
          staffList={staffList}
          shiftsData={shiftsData}
          year={year}
          month={month}
          onChangeMonth={changeMonth}
          onBack={() => setPage("adminDash")}
          parenOverrides={parenOverrides}
          onToggleParen={toggleParen}
          eventOverrides={eventOverrides}
          onToggleEvent={toggleEvent}
          groups={groups}
          onSaveShift={saveShift}
        />
      )}

      {page === "staffManage" && (
        <StaffManagePage
          staffList={staffList}
          groups={groups}
          onSave={saveStaff}
          onBack={() => setPage("adminDash")}
        />
      )}

      {page === "groupManage" && (
        <GroupManagePage
          groups={groups}
          onSave={saveGroups}
          onBack={() => setPage("adminDash")}
        />
      )}

      {page === "changePass" && (
        <ChangePasswordPage
          adminPass={adminPass}
          onSave={saveAdminPass}
          onBack={() => setPage("adminDash")}
        />
      )}
    </div>
  );
}
