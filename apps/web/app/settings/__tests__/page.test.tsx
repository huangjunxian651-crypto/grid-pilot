import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const {
  confirmMock,
  stopMutateMock,
  deleteCredentialMutateMock,
  deleteAccountMutateMock,
  updateProfileMutateMock,
} = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  stopMutateMock: vi.fn(),
  deleteCredentialMutateMock: vi.fn(),
  deleteAccountMutateMock: vi.fn(),
  updateProfileMutateMock: vi.fn(),
}));

vi.mock("@/lib/hooks/useConfirm", () => ({
  useConfirm: () => confirmMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/settings",
}));

vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
  useIsTablet: () => false,
}));

vi.mock("@/lib/hooks/useAuth", () => ({
  useAuth: () => ({ data: { id: "u1", email: "test@test.com", displayName: "Test", language: "zh" } }),
  useLogout: () => ({ mutate: vi.fn() }),
  useChangePassword: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/hooks/useNotifications", () => ({
  useNotifications: () => ({ unreadCount: 0, notifications: [], prefs: {}, togglePref: () => {} }),
}));

vi.mock("@/lib/hooks/useProfile", () => ({
  useProfile: () => ({ data: { id: "u1", displayName: "Test", email: "test@test.com" }, isLoading: false }),
  useUpdateProfile: () => ({ mutate: updateProfileMutateMock, isPending: false }),
  useDeleteAccount: () => ({ mutate: deleteAccountMutateMock, isPending: false }),
}));

vi.mock("@/lib/hooks/useCredentials", () => ({
  useCredentials: () => ({
    data: [
      { id: "cred-1", exchangeId: "binance" },
      { id: "cred-2", exchangeId: "gateio" },
    ],
  }),
  useDeleteCredential: () => ({ mutate: deleteCredentialMutateMock }),
}));

vi.mock("@/lib/hooks/useBots", () => ({
  useRobots: () => ({
    data: [
      { id: "r1", status: "RUNNING" },
      { id: "r2", status: "PAUSED" },
    ],
  }),
  useStopRobot: () => ({ mutate: stopMutateMock }),
}));

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }),
}));

import SettingsPage from "../page";

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

async function renderDangerTab() {
  render(wrap(<SettingsPage />));
  const dangerTab = await screen.findByTestId("settings-tab-danger");
  await act(async () => { fireEvent.click(dangerTab); });
}

describe("SettingsPage — 危险操作确认迁移到 useConfirm", () => {
  beforeEach(() => {
    confirmMock.mockReset();
    stopMutateMock.mockClear();
    deleteCredentialMutateMock.mockClear();
    deleteAccountMutateMock.mockClear();
    updateProfileMutateMock.mockClear();
  });

  describe("停全部机器人", () => {
    it("取消确认时不触发 stopRobot.mutate", async () => {
      confirmMock.mockResolvedValue(false);
      await renderDangerTab();
      const stopAllBtn = screen.getByText("settings.stop_all_btn");
      await act(async () => { fireEvent.click(stopAllBtn); });

      await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
      expect(confirmMock).toHaveBeenCalledWith(
        expect.objectContaining({ tier: "simple", title: "settings.stop_all_confirm_title", confirmLabel: "common.confirm_stop" }),
      );
      expect(stopMutateMock).not.toHaveBeenCalled();
    });

    it("确认后仅对 RUNNING 机器人以 closePosition: true（默认勾选）触发 stopRobot.mutate", async () => {
      confirmMock.mockResolvedValue(true);
      await renderDangerTab();
      const stopAllBtn = screen.getByText("settings.stop_all_btn");
      await act(async () => { fireEvent.click(stopAllBtn); });

      await waitFor(() => {
        expect(stopMutateMock).toHaveBeenCalledTimes(1);
        expect(stopMutateMock).toHaveBeenCalledWith({ id: "r1", closePosition: true });
      });
    });

    it("取消勾选 stop-all-close-pos-checkbox（默认勾选→用户取消勾选）后，以 closePosition: false 触发 stopRobot.mutate", async () => {
      let resolveConfirm: (v: boolean) => void = () => {};
      confirmMock.mockImplementation(
        () => new Promise<boolean>((resolve) => { resolveConfirm = resolve; }),
      );
      await renderDangerTab();
      const stopAllBtn = screen.getByText("settings.stop_all_btn");
      await act(async () => { fireEvent.click(stopAllBtn); });
      await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));

      // 渲染 confirm() 实际收到的 body（与 handleStopAllBots 内部闭包的 closePosRef 共享同一个 onChange 引用）
      const { body } = confirmMock.mock.calls[0][0];
      const { container } = render(body as React.ReactElement);
      const checkbox = container.querySelector('[data-testid="stop-all-close-pos-checkbox"]') as HTMLInputElement;
      expect(checkbox).toBeTruthy();
      expect(checkbox.checked).toBe(true); // 默认勾选
      await act(async () => { fireEvent.click(checkbox); }); // 用户取消勾选
      expect(checkbox.checked).toBe(false);

      await act(async () => { resolveConfirm(true); });
      await waitFor(() => {
        expect(stopMutateMock).toHaveBeenCalledWith({ id: "r1", closePosition: false });
      });
    });
  });

  describe("清空全部密钥", () => {
    it("取消确认时不触发 deleteCredential.mutate", async () => {
      confirmMock.mockResolvedValue(false);
      await renderDangerTab();
      const clearBtn = screen.getByText("settings.clear_creds_btn");
      await act(async () => { fireEvent.click(clearBtn); });

      await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
      expect(confirmMock).toHaveBeenCalledWith({
        tier: "destructive",
        title: "settings.clear_creds_confirm_title",
        body: "settings.clear_creds_confirm_body",
        confirmWord: "CLEAR",
        confirmHint: "settings.clear_creds_confirm_input",
        confirmLabel: "settings.clear_creds_btn",
      });
      expect(deleteCredentialMutateMock).not.toHaveBeenCalled();
    });

    it("确认（destructive 分支，confirmWord=CLEAR）后对每条凭证触发 deleteCredential.mutate", async () => {
      confirmMock.mockResolvedValue(true);
      await renderDangerTab();
      const clearBtn = screen.getByText("settings.clear_creds_btn");
      await act(async () => { fireEvent.click(clearBtn); });

      await waitFor(() => {
        expect(deleteCredentialMutateMock).toHaveBeenCalledTimes(2);
        expect(deleteCredentialMutateMock).toHaveBeenCalledWith("cred-1");
        expect(deleteCredentialMutateMock).toHaveBeenCalledWith("cred-2");
      });
    });
  });

  describe("删除账号", () => {
    it("取消确认时不触发 deleteAccount.mutate", async () => {
      confirmMock.mockResolvedValue(false);
      await renderDangerTab();
      const deleteBtn = screen.getByText("settings.delete_account_btn");
      await act(async () => { fireEvent.click(deleteBtn); });

      await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
      expect(confirmMock).toHaveBeenCalledWith({
        tier: "destructive",
        title: "settings.delete_confirm_title",
        body: "settings.delete_confirm_desc",
        confirmWord: "DELETE",
        confirmHint: "settings.delete_confirm_input",
        confirmLabel: "common.delete",
      });
      expect(deleteAccountMutateMock).not.toHaveBeenCalled();
    });

    it("确认（destructive 分支，confirmWord=DELETE）后触发 deleteAccount.mutate", async () => {
      confirmMock.mockResolvedValue(true);
      await renderDangerTab();
      const deleteBtn = screen.getByText("settings.delete_account_btn");
      await act(async () => { fireEvent.click(deleteBtn); });

      await waitFor(() => {
        expect(deleteAccountMutateMock).toHaveBeenCalledWith(
          undefined,
          expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
      });
    });
  });
});
