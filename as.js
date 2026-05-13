import express from 'express';
import { connect } from 'puppeteer-real-browser';

const app = express();
app.use(express.json());

// ========================
// QUEUE SYSTEM
// ========================
let queue = [];
let isProcessing = false;

async function processQueue() {
    if (isProcessing || queue.length === 0) return;

    isProcessing = true;

    const { req, res } = queue.shift();

    try {
        await handleRequest(req, res);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }

    isProcessing = false;

    // process next request
    processQueue();
}

// ========================
// PROXY PARSER
// ========================
function parseProxy(proxyUrl) {
    const url = new URL(proxyUrl);
    return {
        host: url.hostname,
        port: parseInt(url.port),
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
    };
}

// ========================
// MAIN LOGIC
// ========================
async function handleRequest(req, res) {
    const { proxy_url } = req.body;

    if (!proxy_url) {
        return res.status(400).json({ detail: 'proxy_url is required' });
    }

    const proxy = parseProxy(proxy_url);
    let browser;

    try {
        const { page, browser: br } = await connect({
            headless: false,
            args: [
                '--disable-dev-shm-usage',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',

                // Hide proxy/VPN signals
                '--disable-webrtc',
                '--enforce-webrtc-ip-permission-check',
                '--disable-features=WebRtcHideLocalIpsWithMdns',
                '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',

                // Anti-detection
                '--disable-blink-features=AutomationControlled',
                '--lang=en-US,en',
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
        // NAVIGATION
        // ========================
        await page.goto("https://websurrogates.nycourts.gov", {
            waitUntil: "domcontentloaded",
        });

        console.log("Page opened");

        await page.waitForSelector("#StartSearchButton");

        await Promise.all([
            page.waitForNavigation({ waitUntil: "domcontentloaded" }),
            page.click("#StartSearchButton"),
        ]);

        console.log("Start button clicked");

        await new Promise((r) => setTimeout(r, 12000));

        // ========================
        // CAPTCHA
        // ========================
        try {
            const frameHandle = await page.$('iframe[src*="hcaptcha"]');
            const frame = await frameHandle?.contentFrame();

            if (frame) {
                try {
                    await frame.waitForSelector("#checkbox", { timeout: 10000 });
                    await frame.click("#checkbox");
                    console.log("Captcha clicked");
                } catch {
                    console.log("⚠️ Solve captcha manually");
                }
            }
        } catch { }

        await new Promise((r) => setTimeout(r, 8000));

        await page.waitForFunction(() => {
            const el = document.querySelector("[data-hcaptcha-response]");
            return el && el.getAttribute("data-hcaptcha-response") !== "";
        }, { timeout: 0 });

        console.log("Captcha solved");

        // ========================
        // FILE SEARCH
        // ========================
        await Promise.all([
            page.waitForNavigation({ waitUntil: "domcontentloaded" }),
            page.click("#FileSearch"),
        ]);

        console.log("File search page");

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

        console.log("Search submitted");

        // ========================
        // COLLECT DATA
        // ========================
        const cookies = await page.cookies();
        const cookiesDict = {};
        cookies.forEach(c => cookiesDict[c.name] = c.value);

        const userAgent = await page.evaluate(() => navigator.userAgent);
        const html = await page.content();

        // ========================
        // RESPONSE
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

        throw err;
    }
}


app.post("/get-session", (req, res) => {
    queue.push({ req, res });
    processQueue();
});


const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
    console.log(`🚀 API running on http://localhost:${PORT}`);
});