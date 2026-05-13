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
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-webrtc',
        '--enforce-webrtc-ip-permission-check',
        '--disable-features=WebRtcHideLocalIpsWithMdns',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--disable-blink-features=AutomationControlled',
        '--lang=en-US,en',
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

    console.log("[5] Navigating to websurrogates.nycourts.gov...");
    await page.goto("https://websurrogates.nycourts.gov", {
      waitUntil: "domcontentloaded",
    });
    console.log("[6] Page loaded");

    console.log("[7] Waiting for #StartSearchButton...");
    await page.waitForSelector("#StartSearchButton");
    console.log("[8] Found #StartSearchButton, clicking...");

    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.click("#StartSearchButton"),
    ]);
    console.log("[9] Navigated after StartSearchButton click");

    await new Promise((r) => setTimeout(r, 5000));
    console.log("[10] Wait done, checking for captcha...");

    try {
      const frameHandle = await page.$('iframe[src*="hcaptcha"]');
      const frame = await frameHandle?.contentFrame();

      if (frame) {
        console.log("[11] hCaptcha iframe found, clicking checkbox...");
        try {
          await frame.waitForSelector("#checkbox", { timeout: 10000 });
          await frame.click("#checkbox");
          console.log("[12] Captcha checkbox clicked");
        } catch {
          console.log("[12] Could not click captcha checkbox");
        }
      } else {
        console.log("[11] No hCaptcha iframe found");
      }
    } catch (e) {
      console.log("[11] Captcha error:", e.message);
    }

    await new Promise((r) => setTimeout(r, 4000));
    console.log("[13] Waiting for hcaptcha response token...");

    await page.waitForFunction(() => {
      const el = document.querySelector("[data-hcaptcha-response]");
      return el && el.getAttribute("data-hcaptcha-response") !== "";
    }, { timeout: 25000 });
    console.log("[14] hCaptcha token received");

    console.log("[15] Clicking #FileSearch...");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.click("#FileSearch"),
    ]);
    console.log("[16] Navigated to file search page");

    let requestHeaders = {};
    page.on('request', (req) => {
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
    console.log("[20] Form submitted, collecting cookies...");

    const cookies = await page.cookies();
    const cookiesDict = {};
    for (const c of cookies) {
      cookiesDict[c.name] = c.value;
    }
    console.log(`[21] Collected ${Object.keys(cookiesDict).length} cookies`);

    const userAgent = await page.evaluate(() => navigator.userAgent);
    const html = await page.content();
    console.log("[22] Got user agent and HTML, sending response");

    res.json({
      success: true,
      user_agent: userAgent,
      request_headers: requestHeaders,
      cookies: cookiesDict,
      html,
    });

    await browser.close();
    console.log("[23] Browser closed, done");

  } catch (err) {
    console.error("[ERROR]", err.message);
    console.error(err.stack);
    if (browser) await browser.close();
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 API running on http://localhost:${PORT}`);
});
