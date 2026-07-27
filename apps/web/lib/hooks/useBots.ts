import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  dashboardApi,
  eventsApi,
  robotApi,
  historyApi,
  DashboardKpi,
  EventListResponse,
  Robot,
  RobotDetail,
  AddBoxInput,
  type EditBoxInput,
  type HistoryRange,
  type EquityHistoryResponse,
  type SavingsHistoryResponse,
  type EventsQueryParams,
} from "@/lib/api";

/** STOPPING 期间收紧轮询到 1.5s，让停止阶段进度更跟手；其余 5s。 */
export function stopAwarePollInterval(status: string | undefined): number {
  return status === "STOPPING" ? 1500 : 5000;
}

export function useDashboard() {
  return useQuery<DashboardKpi>({
    queryKey: ["dashboard"],
    queryFn: dashboardApi.get,
  });
}

export function useEquityHistory(range: HistoryRange) {
  return useQuery<EquityHistoryResponse>({
    queryKey: ["equity-history", range],
    queryFn: () => historyApi.equity(range),
    refetchInterval: 60_000,
  });
}

export function useSavingsHistory(range: HistoryRange) {
  return useQuery<SavingsHistoryResponse>({
    queryKey: ["savings-history", range],
    queryFn: () => historyApi.savings(range),
    refetchInterval: 60_000,
  });
}

export function useEvents(params?: EventsQueryParams) {
  return useQuery<EventListResponse>({
    queryKey: ["events", params],
    queryFn: () => eventsApi.list(params),
  });
}

export function useRobots() {
  return useQuery<Robot[]>({
    queryKey: ["robots"],
    queryFn: () => robotApi.list(),
    refetchInterval: (query) => {
      const data = query.state.data as Robot[] | undefined;
      return data?.some((r) => r.status === "STOPPING") ? 1500 : 5000;
    },
  });
}

export function useArchivedRobots() {
  return useQuery<Robot[]>({
    queryKey: ["robots", "archived"],
    queryFn: () => robotApi.listArchived(),
  });
}

export function useRobot(id: string) {
  return useQuery<RobotDetail>({
    queryKey: ["robot", id],
    queryFn: () => robotApi.get(id),
    enabled: !!id,
    refetchInterval: (query) =>
      stopAwarePollInterval((query.state.data as RobotDetail | undefined)?.status),
  });
}

export function useStartRobot() {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean; robotId: string }, Error, string>({
    mutationFn: (id) => robotApi.start(id),
    onSuccess: (_result, id) => {
      queryClient.invalidateQueries({ queryKey: ["robots"] });
      queryClient.invalidateQueries({ queryKey: ["robot", id] });
    },
  });
}

export function usePauseRobot() {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean; robotId: string }, Error, string>({
    mutationFn: (id) => robotApi.pause(id),
    onSuccess: (_result, id) => {
      queryClient.invalidateQueries({ queryKey: ["robots"] });
      queryClient.invalidateQueries({ queryKey: ["robot", id] });
    },
  });
}

export function useStopRobot() {
  const queryClient = useQueryClient();
  return useMutation<
    { success: boolean; robotId: string },
    Error,
    { id: string; closePosition?: boolean }
  >({
    mutationFn: ({ id, closePosition }) => robotApi.stop(id, { closePosition }),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["robots"] });
      queryClient.invalidateQueries({ queryKey: ["robot", id] });
    },
  });
}

export function useReconcileRobot() {
  const queryClient = useQueryClient();
  return useMutation<
    { success: boolean; robotId: string; newFillsCount: number; dbPosition: number; exchangePosition: number; positionMatches: boolean },
    Error,
    string
  >({
    mutationFn: (id) => robotApi.reconcile(id),
    onSuccess: (_result, id) => {
      queryClient.invalidateQueries({ queryKey: ["robots"] });
      queryClient.invalidateQueries({ queryKey: ["robot", id] });
      // 手动对账可能补齐新成交，同步刷新该机器人的成交列表（简单版 + 分页版），
      // 否则 toast 报「N 条新成交」但页面上的列表纹丝不动。
      queryClient.invalidateQueries({ queryKey: ["robot-fills", id] });
      queryClient.invalidateQueries({ queryKey: ["robot-fills-paged", id] });
    },
  });
}

export function useAddBox(robotId: string) {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean; boxId: string }, Error, AddBoxInput>({
    mutationFn: (input) => robotApi.addBox(robotId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["robot", robotId] });
    },
  });
}

export function useRemoveBox(robotId: string) {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean }, Error, { configId: string; closePosition: boolean }>({
    mutationFn: ({ configId, closePosition }) => robotApi.removeBox(robotId, configId, closePosition),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["robot", robotId] });
    },
  });
}

export function useEditBox(robotId: string) {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean }, Error, { configId: string; input: EditBoxInput }>({
    mutationFn: ({ configId, input }) => robotApi.editBox(robotId, configId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["robot", robotId] });
    },
  });
}

export function useCreateRobot() {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean; robotId: string }, Error, { credentialId: string; symbol: string; direction: string }>({
    mutationFn: (input) => robotApi.create(input),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["robots"] }); },
  });
}

export function useBoxPnl(configId: string) {
  return useQuery<{ realizedPnl: number; fillCount: number }>({
    queryKey: ["boxPnl", configId],
    queryFn: () => robotApi.boxPnl(configId),
    enabled: !!configId,
  });
}

export function useBoxFills(configId: string) {
  return useQuery({
    queryKey: ["boxFills", configId],
    queryFn: () => robotApi.boxFills(configId),
    enabled: !!configId,
  });
}

export function useRobotFills(robotId: string, limit = 100) {
  return useQuery({
    queryKey: ["robot-fills", robotId, limit],
    queryFn: () => robotApi.robotFills(robotId, limit),
    enabled: !!robotId,
    refetchInterval: 4000,
  });
}

// 成交流分页：游标翻页（滚到底加载更多），不轮询全量——新成交由 WebSocket 插顶。
// 可选 orderSearch 走服务端按 orderId/clientOrderId 过滤，避免拉全量再前端筛。
const ROBOT_FILLS_PAGE_SIZE = 50;
export function useRobotFillsPaged(robotId: string, opts?: { orderSearch?: string }) {
  const orderSearch = opts?.orderSearch?.trim() || undefined;
  return useInfiniteQuery({
    queryKey: ["robot-fills-paged", robotId, orderSearch ?? ""],
    queryFn: ({ pageParam }) =>
      robotApi.robotFills(robotId, ROBOT_FILLS_PAGE_SIZE, { cursor: pageParam, orderSearch }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!robotId,
  });
}
