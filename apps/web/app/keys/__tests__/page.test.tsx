import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// 隔离 ReferralCta/useReferralMirrors 的网络副作用：fetch 永不 resolve
// （与 referral-register-prompt.test.tsx 相同的隔离手法）
vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

vi.mock("next/navigation", () => ({
  usePathname: () => "/keys",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }),
}));

vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
  useIsTablet: () => false,
}));

vi.mock("@/lib/hooks/useAuth", () => ({
  useAuth: () => ({ data: { id: "u1", email: "test@test.com", displayName: "Test", language: "zh" } }),
  useLogout: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/lib/hooks/useNotifications", () => ({
  useNotifications: () => ({ unreadCount: 0, notifications: [], prefs: {}, togglePref: () => {} }),
}));

vi.mock("@/lib/hooks/useProfile", () => ({
  useUpdateProfile: () => ({ mutate: () => {} }),
}));

vi.mock("@/lib/hooks/useBots", () => ({
  useRunningBots: () => ({ data: [] }),
  useRobots: () => ({ data: [] }),
}));

const credentialGet = vi.fn();
vi.mock("@/lib/api", () => ({
  getAccounts: vi.fn().mockResolvedValue([]),
  credentialApi: { get: (...a: unknown[]) => credentialGet(...a) },
}));

let mockCredentials: Array<Record<string, unknown>> = [];
const createMutate = vi.fn();
const updateMutate = vi.fn();
const deleteMutate = vi.fn();
const confirmMock = vi.fn();

vi.mock("@/lib/hooks/useCredentials", () => ({
  useCredentials: () => ({ data: mockCredentials, isLoading: false }),
  useCreateCredential: () => ({ mutate: createMutate, isPending: false }),
  useUpdateCredential: () => ({ mutate: updateMutate, isPending: false }),
  useDeleteCredential: () => ({ mutate: deleteMutate, isPending: false }),
}));

vi.mock("@/lib/hooks/useConfirm", () => ({
  useConfirm: () => confirmMock,
}));

import ExchangeKeysPage from "../page";

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  mockCredentials = [];
  createMutate.mockClear();
  updateMutate.mockClear();
  deleteMutate.mockClear();
  confirmMock.mockClear();
  credentialGet.mockReset();
  credentialGet.mockResolvedValue({ apiKeyMasked: "AAAA***BBBB", apiSecretMasked: "CCCC***DDDD" });
});

describe("ExchangeKeysPage", () => {
  it("创建态：切到正式环境并保存后，mutate 收到的 payload 含 environment: 'live'", async () => {
    render(wrap(<ExchangeKeysPage />));

    // 打开新增表单
    fireEvent.click(screen.getByText("keys.add_credential"));

    // 切到正式环境
    fireEvent.click(screen.getByTestId("keys-env-live"));

    // 填必填字段：accountId/label/apiKey 是 text input(role=textbox)，
    // apiSecret 是 password input（无 textbox role），单独定位。
    const textboxes = screen.getAllByRole("textbox") as HTMLInputElement[];
    // 顺序：accountId, label, apiKey, (passphrase 可选，排在最后)
    fireEvent.change(textboxes[0], { target: { value: "acc-live-1" } });
    fireEvent.change(textboxes[1], { target: { value: "My Live Account" } });
    fireEvent.change(textboxes[2], { target: { value: "API_KEY_VALUE" } });

    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    expect(passwordInput).toBeTruthy();
    fireEvent.change(passwordInput, { target: { value: "API_SECRET_VALUE" } });

    fireEvent.click(screen.getByText("common.save"));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const [payload] = createMutate.mock.calls[0];
    expect(payload.environment).toBe("live");
    expect(payload.accountId).toBe("acc-live-1");
    expect(payload.label).toBe("My Live Account");
    expect(payload.apiKey).toBe("API_KEY_VALUE");
    expect(payload.apiSecret).toBe("API_SECRET_VALUE");
  });

  it("编辑态：environment=live 的凭证进入编辑后渲染只读 Badge，而非可点击的 demo/live 按钮", async () => {
    mockCredentials = [
      {
        id: "cred-1",
        exchangeId: "binance",
        environment: "live",
        accountId: "acc-live-1",
        label: "My Live Account",
        isActive: true,
        createdAt: new Date().toISOString(),
      },
    ];

    render(wrap(<ExchangeKeysPage />));

    const row = screen.getByText("My Live Account").closest("tr") as HTMLElement;
    expect(row).toBeTruthy();
    const editButton = within(row).getAllByRole("button")[0];
    fireEvent.click(editButton);

    // 编辑按钮点击会异步调用 credentialApi.get 取 masked 值，再展开表单
    await waitFor(() => expect(credentialGet).toHaveBeenCalledWith("cred-1"));
    await waitFor(() => expect(screen.getByText("keys.edit_credential")).toBeTruthy());

    // 编辑态下不应渲染 demo/live 两个可点击切换按钮
    expect(screen.queryByTestId("keys-env-demo")).not.toBeInTheDocument();
    expect(screen.queryByTestId("keys-env-live")).not.toBeInTheDocument();

    // 应渲染只读徽章，显示实盘对应 i18n key（mock t 直接返回 key 本身）
    const badges = screen.getAllByText("keys.environment_live");
    expect(badges.length).toBeGreaterThan(0);
  });

  it("删除凭证：取消确认框后 mutate 不触发", async () => {
    mockCredentials = [
      {
        id: "cred-to-delete",
        exchangeId: "binance",
        environment: "demo",
        accountId: "acc-1",
        label: "Test Cred",
        isActive: true,
        createdAt: new Date().toISOString(),
      },
    ];

    confirmMock.mockResolvedValueOnce(false);
    render(wrap(<ExchangeKeysPage />));

    const row = screen.getByText("Test Cred").closest("tr") as HTMLElement;
    const buttons = within(row).getAllByRole("button");
    const deleteButton = buttons[buttons.length - 1]; // 最后一个按钮是删除
    fireEvent.click(deleteButton);

    // 给异步 confirm 时间来 resolve
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    // deleteMutation 不应被触发
    expect(deleteMutate).not.toHaveBeenCalled();
  });

  it("删除凭证：确认后 mutate 被调用", async () => {
    mockCredentials = [
      {
        id: "cred-to-delete",
        exchangeId: "binance",
        environment: "demo",
        accountId: "acc-1",
        label: "Test Cred",
        isActive: true,
        createdAt: new Date().toISOString(),
      },
    ];

    confirmMock.mockResolvedValueOnce(true);
    render(wrap(<ExchangeKeysPage />));

    const row = screen.getByText("Test Cred").closest("tr") as HTMLElement;
    const buttons = within(row).getAllByRole("button");
    const deleteButton = buttons[buttons.length - 1];
    fireEvent.click(deleteButton);

    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    // deleteMutation 应被调用，并传入正确的 id
    expect(deleteMutate).toHaveBeenCalledWith("cred-to-delete");
    expect(deleteMutate).toHaveBeenCalledTimes(1);
  });
});
