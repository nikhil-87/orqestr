import axios from "axios";

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
});

let isRefreshing = false;
let refreshQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("accessToken");
    const orgId = localStorage.getItem("currentOrganizationId");

    // Guarantee Authorization header is always attached if token exists
    if (token && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Only attach organization header if an authenticated session is active
    if (token && orgId && orgId !== "personal" && orgId.trim() !== "") {
      config.headers["x-organization-id"] = orgId;
    } else {
      delete config.headers["x-organization-id"];
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    const originalRequest = error.config;

    // Auto-recover if user is not a member of the requested organization
    if (
      error.response?.status === 403 &&
      (error.response?.data?.code === "FORBIDDEN_ORGANIZATION" ||
        error.response?.data?.message?.includes("not a member of this organization") ||
        error.response?.data?.message?.includes("You do not have access to this organization"))
    ) {
      if (typeof window !== "undefined") {
        localStorage.removeItem("currentOrganizationId");
        window.dispatchEvent(new CustomEvent("organization-reset"));
      }
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          refreshQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken =
          typeof window !== "undefined" ? localStorage.getItem("refreshToken") : null;

        const { data } = await axios.post(
          `${api.defaults.baseURL}/api/auth/refresh`,
          { refreshToken },
          { withCredentials: true },
        );

        const newToken = data.data.accessToken;
        if (data.data?.refreshToken && typeof window !== "undefined") {
          localStorage.setItem("refreshToken", data.data.refreshToken);
        }
        if (typeof window !== "undefined") {
          localStorage.setItem("accessToken", newToken);
        }
        api.defaults.headers.common.Authorization = `Bearer ${newToken}`;

        refreshQueue.forEach(({ resolve }) => resolve(newToken));
        refreshQueue = [];

        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch {
        delete api.defaults.headers.common.Authorization;
        if (typeof window !== "undefined") {
          localStorage.removeItem("accessToken");
          localStorage.removeItem("refreshToken");
        }
        refreshQueue.forEach(({ reject }) => reject(error));
        refreshQueue = [];

        if (
          typeof window !== "undefined" &&
          !window.location.pathname.startsWith("/workflows/new") &&
          !window.location.pathname.startsWith("/auth/")
        ) {
          window.location.href = `/auth/login?redirect=${encodeURIComponent(window.location.pathname)}`;
        }
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    const message =
      error.response?.data?.message || error.message || "Something went wrong";
    return Promise.reject(new Error(message));
  },
);
