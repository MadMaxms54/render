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

        // fake GPU so WebGL/canvas fingerprint looks real
        "--use-gl=swiftshader",
        "--enable-webgl",
        "--enable-accelerated-2d-canvas",

        // hide automation
        "--disable-blink-features=AutomationControlled",

        // hide proxy/WebRTC leaks
        "--disable-webrtc",
        "--enforce-webrtc-ip-permission-check",
        "--disable-features=WebRtcHideLocalIpsWithMdns",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",

        // locale/timezone to match US
        "--lang=en-US,en",
        "--accept-lang=en-US,en;q=0.9",

        // font rendering
        "--font-render-hinting=none",
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

    // spoof timezone, language, platform to match Windows/US
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "platform", { get: () => "Win32" });
      Object.defineProperty(navigator, "language", { get: () => "en-US" });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
      Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
      Object.defineProperty(screen, "width", { get: () => 1920 });
      Object.defineProperty(screen, "height", { get: () => 1080 });
      Object.defineProperty(screen, "colorDepth", { get: () => 24 });

      // spoof timezone to US Eastern
      const origDateTimeFormat = Intl.DateTimeFormat;
      const OrigDate = Date;
      window.Intl.DateTimeFormat = function(locale, options) {
        options = options || {};
        if (!options.timeZone) options.timeZone = "America/New_York";
        return new origDateTimeFormat(locale, options);
      };
      Intl.DateTimeFormat.prototype = origDateTimeFormat.prototype;
    });
    console.log("[5] Browser fingerprint spoofed");

    console.log("[6] Navigating to websurrogates.nycourts.gov...");
    await page.goto("https://websurrogates.nycourts.gov", {
      waitUntil: "domcontentloaded",
    });
    console.log("[7] Page loaded");

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

    // check for captcha
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
