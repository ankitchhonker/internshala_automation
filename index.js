import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";

dotenv.config();
puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  })
);

const INTERN_URL = "https://internshala.com/";
const delay = (ms) => new Promise((res) => setTimeout(res, ms));
let clients = [];

function sendLog(message) {
  console.log(message);
  clients.forEach((c) => {
    try {
      c.write(`data: ${message}\n\n`);
    } catch (e) {
      // ignore write errors
    }
  });
}

/* -------------------------  Login  ------------------------- */
async function login(page) {
  sendLog("🔐 Navigating to login...");
  await page.goto(`${INTERN_URL}login/student`, { waitUntil: "networkidle2" });

  if (!process.env.EMAIL || !process.env.PASSWORD) {
    throw new Error("EMAIL or PASSWORD not set in environment");
  }

  await page.waitForSelector("#email", { visible: true, timeout: 10000 });
  await page.type("#email", process.env.EMAIL, { delay: 20 });
  await delay(500);
  await page.type("#password", process.env.PASSWORD, { delay: 20 });

  await delay(800);
  await Promise.all([page.click("#login_submit")]);

  sendLog("⚠️ If CAPTCHA appears, complete it manually.");
  try {
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 45000 });
  } catch {
    sendLog("⚠️ Waiting for manual login verification if captcha was shown.");
  }

  sendLog("✅ Login step finished.");
}

/* -------------------------  Get recommended internships  ------------------------- */
async function getRecommendedInternships(page) {
  sendLog("🔎 Fetching internships...");
  await page.goto(`${INTERN_URL}internships/matching-preferences/`, {
    waitUntil: "networkidle2",
  });

  try {
    await page.waitForSelector("#internship_list_container_1, .internship_list_container", {
      visible: true,
      timeout: 15000,
    });
  } catch {
    sendLog("⚠️ Internship list container not found.");
  }

  await delay(1500);

  const links = await page.$$eval(
    "a[href*='/internship/detail/'], a[href*='/internship/']",
    (els) => Array.from(new Set(els.map((el) => el.href)))
  );

  sendLog(`✅ Found ${links.length} internship links (top 20 selected).`);
  return links.slice(0, 20);
}

/* -------------------------  Apply to single internship  ------------------------- */
async function applyToInternship(page, link) {
  sendLog(`🚀 Opening: ${link}`);
  await page.goto(link, { waitUntil: "domcontentloaded" });

  try {
    let found = null;

    // find Apply button
    for (const sel of [
      "#easy_apply_button",
      "button#easy_apply_button",
      "button.apply_btn, .apply_btn",
    ]) {
      const el = await page.$(sel);
      if (el) {
        found = el;
        break;
      }
    }

    // fallback: any button with "Apply" text
    if (!found) {
      const buttons = await page.$$("button");
      for (const b of buttons) {
        const text = (
          await (await b.getProperty("innerText")).jsonValue()
        ).toString().toLowerCase();
        if (text.includes("apply")) {
          found = b;
          break;
        }
      }
    }

    if (!found) {
      sendLog("⚠️ Apply button not found or already applied.");
      return;
    }

    await found.click();
    sendLog("➡️ Clicked apply button. Waiting for form/modal...");

    try {
      await page.waitForSelector("form, #apply_form, .applyModal, input, textarea, select", {
        visible: true,
        timeout: 8000,
      });
    } catch {
      sendLog("⚠️ Form didn’t appear quickly.");
    }

    await delay(1500);

    // 🪄 Auto-fill all inputs and textareas
    const autoAnswer = "I am a dedicated and passionate learner with hands-on experience in full stack development. I always strive to deliver quality work efficiently.";
    await page.evaluate((autoAnswer) => {
      const fields = document.querySelectorAll(
        "input[type='text'], input[type='number'], input[type='email'], textarea"
      );

      fields.forEach((el) => {
        // Custom handling for known patterns
        const placeholder = el.placeholder?.toLowerCase() || "";
        const name = el.name?.toLowerCase() || "";

        let value = autoAnswer;
        if (placeholder.includes("rate") || name.includes("rate")) value = "5";
        else if (placeholder.includes("sample") || name.includes("sample")) value = "https://github.com/ankitdev"; // example link
        else if (placeholder.includes("hire") || name.includes("hire")) value = "Because I have the right skills, attitude, and enthusiasm to excel in this role.";

        el.focus();
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }, autoAnswer);

    sendLog("✅ Auto-filled input fields and textareas successfully.");

    await delay(1500);

    // 🧩 Try clicking the submit/apply button
    let clickedSubmit = false;
    for (const sel of ["button[type='submit']", "#submit", "button.apply_submit, .apply-submit"]) {
      const submit = await page.$(sel);
      if (submit) {
        await submit.click();
        clickedSubmit = true;
        break;
      }
    }

    if (!clickedSubmit) {
      const buttons = await page.$$("button");
      for (const b of buttons) {
        const text = (
          await (await b.getProperty("innerText")).jsonValue()
        ).toString().toLowerCase();
        if (text.includes("submit") || text.includes("apply")) {
          await b.click();
          clickedSubmit = true;
          break;
        }
      }
    }

    if (clickedSubmit) {
      sendLog("✅ Attempted to submit (may require confirmation).");
    } else {
      sendLog("⚠️ Could not find a submit button; please check manually.");
    }
  } catch (err) {
    sendLog("❌ Error in applyToInternship: " + err.message);
  }
}

/* -------------------------  Main flow  ------------------------- */
async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  try {
    await login(page);
    const internships = await getRecommendedInternships(page);
    for (const link of internships) {
      await applyToInternship(page, link);
      await delay(2000);
    }
    sendLog("🎯 Finished processing internships.");
  } catch (err) {
    sendLog("❌ Fatal error: " + err.message);
  } finally {
    try {
      // await browser.close();
    } catch {}
  }
}

/* -------------------------  Routes  ------------------------- */
app.post("/api/start", (req, res) => {
  sendLog("⚙️ Automation triggered...");
  res.json({ msg: "Automation started" });
  main().catch((err) => sendLog(`❌ Error: ${err.message}`));
});

app.get("/api/logs", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  clients.push(res);
  sendLog("🟢 Frontend connected to logs");
  req.on("close", () => {
    clients = clients.filter((c) => c !== res);
    sendLog("🔴 Frontend disconnected");
  });
});

app.listen(5000, () => console.log("🚀 Server running on port 5000"));
