import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import dotenv from "dotenv";
import express, { json } from "express";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({});


dotenv.config();
const app = express();
app.use(json());
app.use(cors({
  origin: "http://localhost:5173",
  methods: ["GET", "POST"],
}));

puppeteer.use(StealthPlugin());

const INTERN_URL = "https://internshala.com/";
const delay = (ms) => new Promise(res => setTimeout(res, ms));
let clients = [];

function sendLog(message) {
  console.log(message);
  clients.forEach(c => c.write(`data: ${message}\n\n`));
}

async function login(page) {
  sendLog("🔐 Logging into Internshala...");
  await page.goto(`${INTERN_URL}login/student`, { waitUntil: "networkidle2" });
  await page.type("#email", process.env.EMAIL, { delay: 10 });
  await delay(2000)
  await page.type("#password", process.env.PASSWORD, { delay: 10 });
  await delay(3000)
  await page.click("#login_submit");
  sendLog("⚠️ Please solve CAPTCHA manually...");
  await page.waitForNavigation({ waitUntil: "networkidle2" });
  sendLog("✅ Logged in successfully!");
}

async function getRecommendedInternships(page) {
  sendLog("🔎 Fetching internships from matching preferences...");
  await page.goto(`${INTERN_URL}internships/matching-preferences/`, { waitUntil: "networkidle2" });
  await page.waitForSelector("#internship_list_container_1", { visible: true });
  await delay(3000);
  const links = await page.$$eval(
    "#internship_list_container_1 a[href*='/internship/detail/']",
    (els) => els.map(el => el.href)
  );
  sendLog(`✅ Found ${links.length} internships.`);
  return links.slice(0, 20);
}

async function extractVisibleFields(page) {
  const fields = await page.$$eval(
    "input, textarea, select",
    (els) => els
      .filter(el => {
        const style = window.getComputedStyle(el);
        return (
          el.offsetParent !== null &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          !["hidden","submit","button","file"].includes(el.type)
        );
      })
      .map(el => ({
        label: el.closest("label")?.innerText?.trim() || el.placeholder || el.name || "Unlabeled field",
        tag: el.tagName.toLowerCase(),
        type: el.type || el.tagName.toLowerCase()
      }))
  );
  return fields;
}

async function getAIAnswers(fields, internshipTitle) {
  // Build a concise prompt
  const prompt = `
You are an assistant generating short professional answers for an internship application.
Internship Title: ${internshipTitle}
Applicant: ankit — Skills: MERN TECH C++, javascript.
Form fields:
${fields.map((f, i) => `${i + 1}. ${f.label}`).join("\n")}

Respond **only** in valid JSON mapping field label → answer.
`;
  const response = await ai.models.generateContent({
    contents: [
      {
        role: "user",
        contents: prompt
      },
    ],
  });

  console.log(response.text);

   
  try {
    answers = JSON.parse(text);
  } catch (err) {
    sendLog("⚠️ Could not parse AI response as JSON. Response: " + text);
    // fallback: map each field to generic answer
    fields.forEach(f => { answers[f.label] = "Available upon request."; });
  }
  return answers;
}

async function fillForm(page, answers) {
  for (const [label, answer] of Object.entries(answers)) {
    await page.evaluate((label, answer) => {
      const els = Array.from(document.querySelectorAll("input, textarea, select"));
      const target = els.find(el => 
        el.closest("label")?.innerText?.trim().includes(label) ||
        el.placeholder?.includes(label)
      );
      if (target) {
        target.focus();
        if (target.tagName.toLowerCase() === "select") {
          target.value = answer;
          target.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          target.value = answer;
          target.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
    }, label, answer);
  }
}

async function applyToInternship(page, link) {
  sendLog(`🚀 Opening: ${link}`);
  await page.goto(link, { waitUntil: "domcontentloaded" });
  const applyBtn = await page.$("#easy_apply_button");
  if (!applyBtn) {
    sendLog("⚠️ Apply button not found or already applied.");
    return;
  }
  await delay(3000);
  await applyBtn.click();
  await delay(2000);

  // Extract visible fields
  // const fields = await extractVisibleFields(page);
  // sendLog(`📋 Found ${fields.length} form fields.`);
  
  // Extract internship title for context
  const internshipTitle = await page.title();

  // const answers = await getAIAnswers(fields, internshipTitle);
  // sendLog("🤖 AI-generated answers ready.");

  // await fillForm(page, answers);
  // sendLog("📝 Form filled with AI answers.");

  await delay(2000);
  await page.click("#submit");
  sendLog("✅ Application submitted successfully!");
}

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null,
    args: ["--start-maximized"],
  });
  const page = await browser.newPage();

  await login(page);
  const internships = await getRecommendedInternships(page);
  for (const link of internships) {
    await applyToInternship(page, link);
    await delay(2000); // small delay between applications
  }
  sendLog("🎯 Top 20 internships processed!");
  await browser.close();
}

app.post("/api/start", (req, res) => {
  sendLog("⚙️ Automation triggered from frontend...");
  res.json({ msg: "Automation started" });
  main().catch(err => sendLog(`❌ Error: ${err.message}`));
});

app.get("/api/logs", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  clients.push(res);
  sendLog("🟢 New frontend connected to logs");
  req.on("close", () => {
    clients = clients.filter(c => c !== res);
    sendLog("🔴 Frontend disconnected");
  });
});

app.listen(5000, () => console.log("🚀 Server running on port 5000"));
