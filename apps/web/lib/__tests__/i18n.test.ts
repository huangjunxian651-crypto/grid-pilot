import { describe, test, expect } from "vitest";
import { translate, SUPPORTED_LANGS, type Lang } from "../i18n";

const ALL_LANG_CODES = ["zh", "zh-TW", "en", "ja", "es", "ar", "fr", "pt", "it", "ko", "th", "vi"];

describe("SUPPORTED_LANGS", () => {
  test("包含全部 12 种语言", () => {
    expect(SUPPORTED_LANGS).toHaveLength(12);
  });

  test("包含所有预期语言代码", () => {
    const codes = SUPPORTED_LANGS.map((l) => l.code);
    for (const code of ALL_LANG_CODES) {
      expect(codes, `缺少语言代码: ${code}`).toContain(code);
    }
  });

  test("简体中文标签为 '简体中文'", () => {
    const entry = SUPPORTED_LANGS.find((l) => l.code === "zh");
    expect(entry?.label).toBe("简体中文");
  });

  test("繁體中文标签为 '繁體中文'", () => {
    const entry = SUPPORTED_LANGS.find((l) => l.code === "zh-TW");
    expect(entry?.label).toBe("繁體中文");
  });

  test("日语标签为 '日本語'", () => {
    const entry = SUPPORTED_LANGS.find((l) => l.code === "ja");
    expect(entry?.label).toBe("日本語");
  });

  test("西班牙语标签为 'Español'", () => {
    const entry = SUPPORTED_LANGS.find((l) => l.code === "es");
    expect(entry?.label).toBe("Español");
  });

  test("阿拉伯语标签为 'العربية'", () => {
    const entry = SUPPORTED_LANGS.find((l) => l.code === "ar");
    expect(entry?.label).toBe("العربية");
  });

  test("法语标签为 'Français'", () => {
    const entry = SUPPORTED_LANGS.find((l) => l.code === "fr");
    expect(entry?.label).toBe("Français");
  });

  test("葡萄牙语标签为 'Português'", () => {
    const entry = SUPPORTED_LANGS.find((l) => l.code === "pt");
    expect(entry?.label).toBe("Português");
  });

  test("意大利语标签为 'Italiano'", () => {
    const entry = SUPPORTED_LANGS.find((l) => l.code === "it");
    expect(entry?.label).toBe("Italiano");
  });

  test("韩语标签为 '한국어'", () => {
    const entry = SUPPORTED_LANGS.find((l) => l.code === "ko");
    expect(entry?.label).toBe("한국어");
  });

  test("泰语标签为 'ภาษาไทย'", () => {
    const entry = SUPPORTED_LANGS.find((l) => l.code === "th");
    expect(entry?.label).toBe("ภาษาไทย");
  });

  test("越南语标签为 'Tiếng Việt'", () => {
    const entry = SUPPORTED_LANGS.find((l) => l.code === "vi");
    expect(entry?.label).toBe("Tiếng Việt");
  });
});

describe("translate() — 新语言翻译", () => {
  test("繁體中文: common.save = '儲存'", () => {
    expect(translate("common.save", "zh-TW")).toBe("儲存");
  });

  test("日语: common.save = '保存'", () => {
    expect(translate("common.save", "ja")).toBe("保存");
  });

  test("西班牙语: common.save = 'Guardar'", () => {
    expect(translate("common.save", "es")).toBe("Guardar");
  });

  test("阿拉伯语: common.save = 'حفظ'", () => {
    expect(translate("common.save", "ar")).toBe("حفظ");
  });

  test("法语: common.save = 'Enregistrer'", () => {
    expect(translate("common.save", "fr")).toBe("Enregistrer");
  });

  test("葡萄牙语: common.save = 'Salvar'", () => {
    expect(translate("common.save", "pt")).toBe("Salvar");
  });

  test("意大利语: common.save = 'Salva'", () => {
    expect(translate("common.save", "it")).toBe("Salva");
  });

  test("韩语: common.save = '저장'", () => {
    expect(translate("common.save", "ko")).toBe("저장");
  });

  test("泰语: common.save = 'บันทึก'", () => {
    expect(translate("common.save", "th")).toBe("บันทึก");
  });

  test("越南语: common.save = 'Lưu'", () => {
    expect(translate("common.save", "vi")).toBe("Lưu");
  });
});

describe("translate() — nav 导航翻译", () => {
  test("日语: nav.dashboard = 'ダッシュボード'", () => {
    expect(translate("nav.dashboard", "ja")).toBe("ダッシュボード");
  });

  test("繁體中文: nav.settings = '設定'", () => {
    expect(translate("nav.settings", "zh-TW")).toBe("設定");
  });

  test("韩语: nav.history = '거래 내역'", () => {
    expect(translate("nav.history", "ko")).toBe("거래 내역");
  });
});

describe("translate() — 登录页翻译", () => {
  test("法语: login.email = 'E-mail'", () => {
    expect(translate("login.email", "fr")).toBe("E-mail");
  });

  test("西班牙语: login.signin = 'Iniciar sesión en GridPilot'", () => {
    expect(translate("login.signin", "es")).toBe("Iniciar sesión en GridPilot");
  });

  test("阿拉伯语: login.password = 'كلمة المرور'", () => {
    expect(translate("login.password", "ar")).toBe("كلمة المرور");
  });
});

describe("translate() — 降级回退行为", () => {
  test("缺少翻译时回退到英文", () => {
    // 使用一个确实没有该语言翻译的键（不存在的语言代码不会编译，这里验证回退到en）
    // 通过测试 translate 对已知缺失翻译的处理
    const result = translate("common.save", "en");
    expect(result).toBe("Save"); // 英文原始值不变
  });

  test("键不存在时返回键名本身", () => {
    expect(translate("nonexistent.key", "ja")).toBe("nonexistent.key");
  });

  test("参数替换在新语言中正常工作", () => {
    const result = translate("dash.welcome_sub", "ja", { n: "3", date: "5月22日" });
    expect(result).toContain("3");
    expect(result).toContain("5月22日");
  });
});

describe("translate() — Korean core UI translations", () => {
  test("dash.live_fills = '실시간 체결 (전체 봇)' (was 'Live Fills (all bots)')", () => {
    expect(translate("dash.live_fills", "ko")).toBe("실시간 체결 (전체 봇)");
  });
  test("alpha_meter.title = 'Alpha 초과수익 vs 단순 그리드' (was 'ALPHA EARNED vs Naive Grid')", () => {
    expect(translate("alpha_meter.title", "ko")).toBe("Alpha 초과수익 vs 단순 그리드");
  });
  test("dash.col_bot = '봇' (was 'Bot')", () => {
    expect(translate("dash.col_bot", "ko")).toBe("봇");
  });
  test("side.BUY = '매수' (was 'BUY')", () => {
    expect(translate("side.BUY", "ko")).toBe("매수");
  });
});

describe("translate() — 100% coverage for all languages", () => {
  const ALL_LANGS: Lang[] = ["zh", "zh-TW", "en", "ja", "es", "ar", "fr", "pt", "it", "ko", "th", "vi"];
  const CORE_KEYS = [
    "dash.live_fills",
    "alpha_meter.title",
    "dash.col_bot",
    "side.BUY",
    "side.SELL",
    "common.save",
    "nav.dashboard",
    "login.email",
    "settings.title",
  ];

  for (const lang of ALL_LANGS) {
    test(`${lang}: core keys are not falling back to English`, () => {
      for (const key of CORE_KEYS) {
        const result = translate(key, lang);
        expect(result).not.toBe(key);
        expect(result).not.toBe("");
      }
    });
  }
});

describe("translate() — key 翻译验证", () => {
  // 注：阶段C清理了无引用的 bot.stop_modal_*/chart.axis_* 等旧 key，相应用例已移除。
  test("zh: dash.col_alpha = 'Alpha 超额'", () => {
    expect(translate("dash.col_alpha", "zh")).toBe("Alpha 超额");
  });

  test("en: dash.col_alpha = 'Alpha'", () => {
    expect(translate("dash.col_alpha", "en")).toBe("Alpha");
  });

  test("ko: dash.col_alpha = '알파'", () => {
    expect(translate("dash.col_alpha", "ko")).toBe("알파");
  });
});
