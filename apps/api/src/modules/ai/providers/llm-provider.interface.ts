/** 提供方抽象：给定系统/用户提示与 JSON Schema，返回解析后的结构化对象。 */
export interface LlmProvider {
  readonly name: string;
  completeJson<T>(system: string, user: string, schema: object): Promise<T>;
}
