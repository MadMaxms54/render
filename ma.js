const express = require("express");
const { connect } = require("puppeteer-real-browser");

const app = express();
app.use(express.json());
const PORT = 3000;

function parseProxy(proxyUrl) {
  const url = new URL(proxyUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

// full fingerprint spoof injected before every page load
const FINGERPRINT_SCRIPT = `
  // --- Navigator ---
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
  Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
  Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });
  Object.defineProperty(navigator, 'appVersion', { get: () => '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' });

  // --- Screen ---
  Object.defineProperty(screen, 'width', { get: () => 1920 });
  Object.defineProperty(screen, 'height', { get: () => 1080 });
  Object.defineProperty(screen, 'availWidth', { get: () => 1920 });
  Object.defineProperty(screen, 'availHeight', { get: () => 1040 });
  Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
  Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
  Object.defineProperty(window, 'devicePixelRatio', { get: () => 1 });

  // --- WebGL: spoof real Intel GPU instead of SwiftShader ---
  const spoofWebGL = (ctx) => {
    if (!ctx) return;
    const orig = ctx.getParameter.bind(ctx);
    ctx.getParameter = function(param) {
      if (param === 37445) return 'Intel Inc.';
      if (param === 37446) return 'Intel(R) Iris(TM) Plus Graphics 640';
      return orig(param);
    };
  };
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, ...args) {
    const ctx = origGetContext.apply(this, [type, ...args]);
    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') spoofWebGL(ctx);
    return ctx;
  };

  // --- Chrome object (missing in headless) ---
  if (!window.chrome) {
    window.chrome = {
      app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
      runtime: {
        OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', GC_REQUIRED: 'gc_required', OS_UPDATE: 'os_update' },
        PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
        RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
      },
    };
  }

  // --- Plugins: mimic real Chrome plugins ---
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const arr = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ];
      arr.item = (i) => arr[i];
      arr.namedItem = (n) => arr.find(p => p.name === n) || null;
      arr.refresh = () => {};
      return arr;
    }
  });

  // --- Mime types ---
  Object.defineProperty(navigator, 'mimeTypes', {
    get: () => {
      const arr = [
        { type: 'application/pdf', suffixes: 'pdf', description: '', enabledPlugin: {} },
        { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: {} },
        { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable', enabledPlugin: {} },
        { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable', enabledPlugin: {} },
      ];
      arr.item = (i) => arr[i];
      arr.namedItem = (n) => arr.find(m => m.type === n) || null;
      return arr;
    }
  });

  // --- Timezone ---
  const _DateTimeFormat = Intl.DateTimeFormat;
  Intl.DateTimeFormat = function(locale, options = {}) {
    if (!options.timeZone) options.timeZone = 'America/New_York';
    return new _DateTimeFormat(locale, options);
  };
  Intl.DateTimeFormat.prototype = _DateTimeFormat.prototype;

  // --- Permissions API: mimic real browser ---
  const origQuery = window.navigator.permissions && window.navigator.permissions.query.bind(window.navigator.permissions);
  if (origQuery) {
    window.navigator.permissions.query = (parameters) => {
      if (parameters.name === 'notifications') return Promise.resolve({ state: Notification.permission });
      return origQuery(parameters);
    };
  }

  // --- Remove headless traces ---
  delete navigator.__proto__.webdriver;
`;

app.post("/get-session", async (req, res) => {
  console.log("[1] Request received");
  const { proxy_url } = req.body;
  if (!proxy_url) {
    console.log("[!] Missing proxy_url");
    return res.status(400).json({ detail: 'proxy_url are required' });
  }

  const proxy = parseProxy(proxy_url);
  console.log(`[2] Proxy parsed: ${proxy.host}:${proxy.port}`);

  let browser;
  try {
    console.log("[3] Launching browser...");
    const { page, browser: br } = await connect({
      headless: false,
      args: [
        "--start-maximized",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--use-gl=swiftshader",
        "--enable-webgl",
        "--enable-accelerated-2d-canvas",
        "--disable-blink-features=AutomationControlled",
        "--disable-webrtc",
        "--enforce-webrtc-ip-permission-check",
        "--disable-features=WebRtcHideLocalIpsWithMdns",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--lang=en-US,en",
      ],
      turnstile: true,
      connectOption: { defaultViewport: null },
      proxy: {
        host: proxy.host,
        port: proxy.port,
        username: proxy.username,
        password: proxy.password,
      },
    });

    browser = br;
    console.log("[4] Browser launched");

    await page.evaluateOnNewDocument(FINGERPRINT_SCRIPT);
    console.log("[5] Fingerprint spoofing injected");

    console.log("[6] Navigating to websurrogates.nycourts.gov...");
    await page.goto("https://websurrogates.nycourts.gov", {
      waitUntil: "domcontentloaded",
    });
    console.log("[7] Page loaded");

    // log fingerprint check
    const fp = await page.evaluate(() => ({
      platform: navigator.platform,
      webdriver: navigator.webdriver,
      languages: navigator.languages,
      plugins: navigator.plugins.length,
      webgl: (() => {
        try {
          const c = document.createElement('canvas');
          const gl = c.getContext('webgl');
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          return { vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) };
        } catch(e) { return e.message; }
      })(),
    }));
    console.log("[7b] Fingerprint:", JSON.stringify(fp));

    console.log("[8] Waiting for #StartSearchButton...");
    await page.waitForSelector("#StartSearchButton");
    console.log("[9] Clicking #StartSearchButton...");

    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.click("#StartSearchButton"),
    ]);
    console.log("[10] Navigated after StartSearchButton click");

    console.log("[11] Waiting 8 seconds for captcha to load...");
    await new Promise((r) => setTimeout(r, 8000));

    const captchaFrame = await page.$('iframe[src*="hcaptcha"]');
    if (captchaFrame) {
      console.log("[12] hCaptcha iframe found, clicking checkbox...");
      try {
        const frame = await captchaFrame.contentFrame();
        await frame.waitForSelector("#checkbox", { timeout: 10000 });
        await frame.click("#checkbox");
        console.log("[13] Captcha checkbox clicked, waiting for auto-solve...");
      } catch (e) {
        console.log("[13] Checkbox click failed:", e.message);
      }
    } else {
      console.log("[12] No captcha found");
    }

    console.log("[14] Waiting for hcaptcha token...");
    await page.waitForFunction(() => {
      const el = document.querySelector("[data-hcaptcha-response]");
      return el && el.getAttribute("data-hcaptcha-response") !== "";
    }, { timeout: 60000 });
    console.log("[15] hCaptcha token received");

    console.log("[16] Clicking #FileSearch...");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.click("#FileSearch"),
    ]);
    console.log("[17] On file search page");

    let requestHeaders = {};
    page.on("request", (req) => {
      if (req.isNavigationRequest() && !Object.keys(requestHeaders).length) {
        requestHeaders = req.headers();
        console.log("[18] Captured request headers");
      }
    });

    console.log("[19] Typing file number...");
    await page.type("#FileNumber", "2025-1");

    console.log("[20] Submitting form...");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.click("button[type='submit']"),
    ]);
    console.log("[21] Form submitted");

    const cookies = await page.cookies();
    const cookiesDict = {};
    for (const c of cookies) cookiesDict[c.name] = c.value;
    console.log(`[22] Collected ${Object.keys(cookiesDict).length} cookies`);

    const userAgent = await page.evaluate(() => navigator.userAgent);
    console.log(`[23] User agent: ${userAgent}`);

    const html = await page.content();
    console.log(`[24] Got HTML (${html.length} chars), sending response`);

    res.json({
      success: true,
      user_agent: userAgent,
      request_headers: requestHeaders,
      cookies: cookiesDict,
      html,
    });

    await browser.close();
    console.log("[25] Browser closed, done");

  } catch (err) {
    console.error("[ERROR]", err.message);
    console.error(err.stack);
    if (browser) await browser.close();
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 API running on http://localhost:${PORT}`);
});
