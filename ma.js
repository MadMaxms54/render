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

const FINGERPRINT_SCRIPT = `
  // --- Navigator ---
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
  Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
  Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });
  Object.defineProperty(navigator, 'doNotTrack', { get: () => null });
  Object.defineProperty(navigator, 'cookieEnabled', { get: () => true });
  Object.defineProperty(navigator, 'onLine', { get: () => true });
  delete navigator.__proto__.webdriver;

  // --- Screen ---
  Object.defineProperty(screen, 'width', { get: () => 1920 });
  Object.defineProperty(screen, 'height', { get: () => 1080 });
  Object.defineProperty(screen, 'availWidth', { get: () => 1920 });
  Object.defineProperty(screen, 'availHeight', { get: () => 1040 });
  Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
  Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
  Object.defineProperty(window, 'devicePixelRatio', { get: () => 1 });
  Object.defineProperty(window, 'outerWidth', { get: () => 1920 });
  Object.defineProperty(window, 'outerHeight', { get: () => 1080 });
  Object.defineProperty(window, 'innerWidth', { get: () => 1920 });
  Object.defineProperty(window, 'innerHeight', { get: () => 1040 });

  // --- WebGL: spoof Intel GPU ---
  const _getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, ...args) {
    const ctx = _getContext.apply(this, [type, ...args]);
    if (ctx && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')) {
      const _getParam = ctx.getParameter.bind(ctx);
      ctx.getParameter = function(param) {
        if (param === 37445) return 'Intel Inc.';
        if (param === 37446) return 'Intel(R) UHD Graphics 620';
        return _getParam(param);
      };
      const _getExt = ctx.getExtension.bind(ctx);
      ctx.getExtension = function(name) {
        if (name === 'WEBGL_debug_renderer_info') {
          return { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };
        }
        return _getExt(name);
      };
    }
    return ctx;
  };

  // --- Chrome object ---
  window.chrome = {
    app: {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails: () => null,
      getIsInstalled: () => false,
      installState: () => 'not_installed',
    },
    runtime: {
      OnInstalledReason: {},
      OnRestartRequiredReason: {},
      PlatformArch: {},
      PlatformOs: {},
      RequestUpdateCheckStatus: {},
      connect: () => {},
      sendMessage: () => {},
    },
    loadTimes: () => ({
      commitLoadTime: Date.now() / 1000 - 1.2,
      connectionInfo: 'http/1.1',
      finishDocumentLoadTime: Date.now() / 1000 - 0.8,
      finishLoadTime: Date.now() / 1000 - 0.5,
      firstPaintAfterLoadTime: 0,
      firstPaintTime: Date.now() / 1000 - 0.9,
      navigationType: 'Other',
      npnNegotiatedProtocol: 'h2',
      requestTime: Date.now() / 1000 - 2,
      startLoadTime: Date.now() / 1000 - 1.5,
      wasAlternateProtocolAvailable: false,
      wasFetchedViaSpdy: true,
      wasNpnNegotiated: true,
    }),
    csi: () => ({ pageT: 4000, startE: Date.now() - 4000, tran: 15 }),
  };

  // --- Plugins ---
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const fakePlugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1 },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 2 },
      ];
      fakePlugins.item = (i) => fakePlugins[i];
      fakePlugins.namedItem = (n) => fakePlugins.find(p => p.name === n) || null;
      fakePlugins.refresh = () => {};
      return fakePlugins;
    }
  });

  // --- MimeTypes ---
  Object.defineProperty(navigator, 'mimeTypes', {
    get: () => {
      const arr = [
        { type: 'application/pdf', suffixes: 'pdf', description: '' },
        { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' },
        { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' },
        { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable' },
      ];
      arr.item = (i) => arr[i];
      arr.namedItem = (n) => arr.find(m => m.type === n) || null;
      return arr;
    }
  });

  // --- Battery API ---
  if (navigator.getBattery) {
    navigator.getBattery = () => Promise.resolve({
      charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1.0,
      addEventListener: () => {}, removeEventListener: () => {},
    });
  }

  // --- Connection ---
  Object.defineProperty(navigator, 'connection', {
    get: () => ({
      downlink: 10, effectiveType: '4g', rtt: 50, saveData: false,
      addEventListener: () => {}, removeEventListener: () => {},
    })
  });

  // --- MediaDevices: fake mic/camera so site thinks real user ---
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    navigator.mediaDevices.enumerateDevices = () => Promise.resolve([
      { deviceId: 'default', groupId: 'abc123', kind: 'audioinput', label: '' },
      { deviceId: 'default', groupId: 'def456', kind: 'audiooutput', label: '' },
      { deviceId: 'default', groupId: 'ghi789', kind: 'videoinput', label: '' },
    ]);
  }

  // --- Permissions ---
  if (navigator.permissions) {
    const _query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (p) => {
      if (p.name === 'notifications') return Promise.resolve({ state: 'prompt', onchange: null });
      if (p.name === 'geolocation') return Promise.resolve({ state: 'prompt', onchange: null });
      return _query(p);
    };
  }

  // --- Timezone ---
  const _DTF = Intl.DateTimeFormat;
  Intl.DateTimeFormat = function(locale, opts = {}) {
    if (!opts.timeZone) opts.timeZone = 'America/New_York';
    return new _DTF(locale, opts);
  };
  Intl.DateTimeFormat.prototype = _DTF.prototype;
  Intl.DateTimeFormat.supportedLocalesOf = _DTF.supportedLocalesOf;

  // --- Notification ---
  window.Notification = window.Notification || {};
  Object.defineProperty(Notification, 'permission', { get: () => 'default' });
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
        // enable real-looking GPU via SwiftShader
        "--use-gl=swiftshader",
        "--enable-webgl",
        "--enable-webgl2",
        "--enable-accelerated-2d-canvas",
        "--ignore-gpu-blocklist",
        "--enable-gpu-rasterization",
        // anti-detection
        "--disable-blink-features=AutomationControlled",
        // hide WebRTC leaks
        "--disable-webrtc",
        "--enforce-webrtc-ip-permission-check",
        "--disable-features=WebRtcHideLocalIpsWithMdns",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        // locale
        "--lang=en-US,en",
        "--accept-lang=en-US,en;q=0.9",
        // make it look like a real user session
        "--enable-features=NetworkService,NetworkServiceInProcess",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
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
    console.log("[5] Fingerprint injected");

    console.log("[6] Navigating to websurrogates.nycourts.gov...");
    await page.goto("https://websurrogates.nycourts.gov", {
      waitUntil: "domcontentloaded",
    });
    console.log("[7] Page loaded");

    const fp = await page.evaluate(() => ({
      platform: navigator.platform,
      webdriver: navigator.webdriver,
      plugins: navigator.plugins.length,
      webgl: (() => {
        try {
          const c = document.createElement('canvas');
          const gl = c.getContext('webgl');
          if (!gl) return 'NULL - WebGL not available';
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          if (!ext) return 'no WEBGL_debug_renderer_info ext';
          return {
            vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL),
            renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
          };
        } catch(e) { return 'error: ' + e.message; }
      })(),
      chrome: typeof window.chrome,
      connection: navigator.connection ? navigator.connection.effectiveType : 'none',
    }));
    console.log("[7b] Fingerprint check:", JSON.stringify(fp));

    console.log("[8] Waiting for #StartSearchButton...");
    await page.waitForSelector("#StartSearchButton");
    console.log("[9] Clicking #StartSearchButton...");

    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.click("#StartSearchButton"),
    ]);
    console.log("[10] Navigated after StartSearchButton click");

    console.log("[11] Waiting 8 seconds for page/captcha to load...");
    await new Promise((r) => setTimeout(r, 8000));

    const captchaFrame = await page.$('iframe[src*="hcaptcha"]');
    if (captchaFrame) {
      console.log("[12] hCaptcha found, clicking checkbox...");
      try {
        const frame = await captchaFrame.contentFrame();
        await frame.waitForSelector("#checkbox", { timeout: 10000 });
        await frame.click("#checkbox");
        console.log("[13] Checkbox clicked, waiting for token...");
      } catch (e) {
        console.log("[13] Checkbox click failed:", e.message);
      }
      await page.waitForFunction(() => {
        const el = document.querySelector("[data-hcaptcha-response]");
        return el && el.getAttribute("data-hcaptcha-response") !== "";
      }, { timeout: 60000 });
      console.log("[14] hCaptcha token received");
    } else {
      console.log("[12] No captcha detected, proceeding...");
    }

    console.log("[15] Clicking #FileSearch...");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.click("#FileSearch"),
    ]);
    console.log("[16] On file search page");

    let requestHeaders = {};
    page.on("request", (req) => {
      if (req.isNavigationRequest() && !Object.keys(requestHeaders).length) {
        requestHeaders = req.headers();
        console.log("[17] Captured request headers");
      }
    });

    console.log("[18] Typing file number...");
    await page.type("#FileNumber", "2025-1");

    console.log("[19] Submitting form...");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.click("button[type='submit']"),
    ]);
    console.log("[20] Form submitted");

    const cookies = await page.cookies();
    const cookiesDict = {};
    for (const c of cookies) cookiesDict[c.name] = c.value;
    console.log(`[21] Collected ${Object.keys(cookiesDict).length} cookies`);

    const userAgent = await page.evaluate(() => navigator.userAgent);
    console.log(`[22] User agent: ${userAgent}`);

    const html = await page.content();
    console.log(`[23] HTML length: ${html.length}, sending response`);

    res.json({
      success: true,
      user_agent: userAgent,
      request_headers: requestHeaders,
      cookies: cookiesDict,
      html,
    });

    await browser.close();
    console.log("[24] Done");

  } catch (err) {
    console.error("[ERROR]", err.message);
    console.error(err.stack);
    if (browser) await browser.close();
    res.status(500).json({ success: false, error: err.message });
  }
});

// debug endpoint - call on localhost AND render to compare fingerprints
app.get("/fingerprint", async (req, res) => {
  let browser;
  try {
    const { page, browser: br } = await connect({
      headless: false,
      args: [
        "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
        "--use-gl=swiftshader", "--enable-webgl", "--enable-webgl2",
        "--ignore-gpu-blocklist", "--enable-gpu-rasterization",
        "--disable-blink-features=AutomationControlled",
      ],
      turnstile: true,
      connectOption: { defaultViewport: null },
    });
    browser = br;
    await page.evaluateOnNewDocument(FINGERPRINT_SCRIPT);
    await page.goto("about:blank");

    const fp = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      languages: navigator.languages,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      plugins: navigator.plugins.length,
      webdriver: navigator.webdriver,
      vendor: navigator.vendor,
      screen: { w: screen.width, h: screen.height, depth: screen.colorDepth },
      devicePixelRatio: window.devicePixelRatio,
      chrome: typeof window.chrome,
      chromeLoadTimes: typeof window.chrome?.loadTimes,
      connection: navigator.connection ? navigator.connection.effectiveType : 'none',
      webgl: (() => {
        try {
          const c = document.createElement('canvas');
          const gl = c.getContext('webgl');
          if (!gl) return 'NULL';
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          if (!ext) return 'no ext';
          return {
            vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL),
            renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
          };
        } catch(e) { return 'error: ' + e.message; }
      })(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      battery: typeof navigator.getBattery,
      mediaDevices: typeof navigator.mediaDevices,
    }));

    await browser.close();
    res.json(fp);
  } catch (err) {
    if (browser) await browser.close();
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 API running on http://localhost:${PORT}`);
});
