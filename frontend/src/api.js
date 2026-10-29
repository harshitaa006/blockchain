const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

async function request(path, options) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
  return data;
}

export const api = {
  health: () => request("/api/health"),
  stats: () => request("/api/stats"),
  listEvidence: () => request("/api/evidence"),
  getEvidence: (recordId) => request(`/api/evidence/${recordId}`),
  analyze: (body) => request("/api/evidence/analyze", { method: "POST", body: JSON.stringify(body) }),
  sign: (recordId) => request(`/api/attestations/${recordId}/sign`, { method: "POST" })
};