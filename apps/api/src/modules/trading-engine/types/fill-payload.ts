export interface FillPayload {
  // WS wire field kept as `sessionCode` to match BotStatus/ticker/fsm events and the
  // frontend's event filter (data.sessionCode). The value is the run's runCode; only
  // the wire key stays `sessionCode`, mirroring the kept HTTP `:sessionCode` route param.
  sessionCode: string;
  id: string;
  side: 'buy' | 'sell';
  price: number;
  qty: number;
  gridIndex: number;
  route: 'POC' | 'GTC';
  fee: number;
  ts: number;
  // NEW: 策略节省金额
  savings: number;
  savingsRate: number;
  avgGridPrice: number;
}
