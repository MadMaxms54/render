const express = require("express");
const { connect } = require("puppeteer-real-browser");

const app = express();
app.use(express.json()); // 👈 add this
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
  const { proxy_url } = req.body;
  if (!proxy_url) {
    return res.status(400).json({ detail: 'proxy_url are required' });
  }
  const proxy = parseProxy(proxy_url);
  let browser;
  try {
    // ========================
    // CONNECT BROWSER
    // ========================
    const { page, browser: br } = await connect({
      headless: false,
      args: [
        "--start-maximized",
      ],
      turnstile: true,
      connectOption: {
        defaultViewport: null,
      },
      proxy: {
        host: proxy.host,
        port: proxy.port,
        username: proxy.username,
        password: proxy.password,
      },
    });

    browser = br;

    // ========================
    // NAVIGATION FLOW
    // ========================
    await page.goto("https://websurrogates.nycourts.gov", {
      waitUntil: "domcontentloaded",
    });

    await page.waitForSelector("#StartSearchButton");

    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.click("#StartSearchButton"),
    ]);

    await new Promise((r) => setTimeout(r, 8000));

    // CAPTCHA
    try {
      const frameHandle = await page.$('iframe[src*="hcaptcha"]');
      const frame = await frameHandle?.contentFrame();

      if (frame) {
        try {
          await frame.waitForSelector("#checkbox", { timeout: 10000 });
          await frame.click("#checkbox");
        } catch {
          console.log("⚠️ Solve captcha manually");
        }
      }
    } catch { }

    await page.waitForFunction(() => {
      const el = document.querySelector("[data-hcaptcha-response]");
      return el && el.getAttribute("data-hcaptcha-response") !== "";
    }, { timeout: 0 });

    // FILE SEARCH
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.click("#FileSearch"),
    ]);

    let requestHeaders = {};
    page.on('request', (req) => {
      if (req.isNavigationRequest() && !Object.keys(requestHeaders).length) {
        requestHeaders = req.headers();
      }
    });
    await page.type("#FileNumber", "2025-1");

    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.click("button[type='submit']"),
    ]);

    // WAIT FOR INTERCEPT
    const cookies = await page.cookies();
    const cookiesDict = {};
    for (const c of cookies) {
      cookiesDict[c.name] = c.value;
    }

    const userAgent = await page.evaluate(() => navigator.userAgent);
    const html = await page.content();

    // ========================
    // RESPONSE (IMPORTANT)
    // ========================
    res.json({
      success: true,
      user_agent: userAgent,
      request_headers: requestHeaders,
      cookies: cookiesDict,
      html,
    });

    await browser.close();

  } catch (err) {
    console.error(err);

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